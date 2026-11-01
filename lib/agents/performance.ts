import { gemini, hasGemini, plainText } from "../gemini";
import type { Assignment, Mastery, Progress } from "../types";

// Performance agent: reads real Quercus grades and the student's topic mastery,
// finds where they're slipping, and quizzes them to measure and build proficiency.

export interface CourseStats {
  courseCode: string;
  course: string;
  graded: number;
  average: number | null; // % across graded work, weighted by points
  recent: number | null; // % on the latest graded item
  trend: number | null; // recent minus the earlier average, in points of %
  late: number;
  missed: number; // past due, not submitted
  open: number;
  hoursLeft: number;
}

export function courseStats(assignments: Assignment[], progress: Record<string, Progress>): CourseStats[] {
  const now = Date.now();
  const courses = new Map<string, Assignment[]>();
  for (const a of assignments) courses.set(a.courseCode, [...(courses.get(a.courseCode) ?? []), a]);
  return [...courses].map(([courseCode, list]) => {
    const graded = list
      .filter((a) => a.score != null && a.points)
      .sort((x, y) => (x.dueAt ?? "").localeCompare(y.dueAt ?? ""));
    const pct = (xs: Assignment[]) => {
      const pts = xs.reduce((n, a) => n + a.points!, 0);
      return pts ? Math.round((xs.reduce((n, a) => n + a.score!, 0) / pts) * 1000) / 10 : null;
    };
    const last = graded[graded.length - 1];
    const recent = last ? Math.round((last.score! / last.points!) * 1000) / 10 : null;
    const earlier = pct(graded.slice(0, -1));
    const open = list.filter((a) => !a.submitted && progress[a.id]?.status !== "done" && (!a.dueAt || new Date(a.dueAt).getTime() > now));
    return {
      courseCode,
      course: list[0].course,
      graded: graded.length,
      average: pct(graded),
      recent,
      trend: recent != null && earlier != null ? Math.round((recent - earlier) * 10) / 10 : null,
      late: list.filter((a) => a.late).length,
      missed: list.filter((a) => !a.submitted && a.dueAt && new Date(a.dueAt).getTime() < now && progress[a.id]?.status !== "done").length,
      open: open.length,
      hoursLeft: open.reduce((n, a) => {
        const p = progress[a.id];
        return n + (p?.steps.length ? p.steps.filter((s) => !s.done).reduce((m, s) => m + s.hours, 0) : 0);
      }, 0),
    };
  });
}

// ---------- Insights ----------

export interface Insight {
  title: string;
  detail: string;
  tone: "good" | "watch" | "act";
}

export async function insights(stats: CourseStats[], mastery: Mastery[]): Promise<{ insights: Insight[]; focus: string; ai: boolean }> {
  const summary = [
    ...stats.map(
      (s) =>
        `${s.courseCode}: average ${s.average ?? "n/a"}% over ${s.graded} graded, latest ${s.recent ?? "n/a"}%, trend ${s.trend ?? "n/a"}, ${s.late} late, ${s.missed} missed, ${s.open} open`,
    ),
    mastery.length ? `Topic mastery: ${mastery.map((m) => `${m.courseCode} ${m.topic} ${m.score}%`).join("; ")}` : "No topic quizzes taken yet.",
  ].join("\n");

  if (hasGemini()) {
    try {
      const { data } = await gemini<{ insights: Insight[]; focus: string }>({
        system:
          "You are a performance coach for a university student. You read their grades and quiz mastery and give honest, specific, encouraging insights. " +
          "Never invent numbers that aren't in the data.",
        prompt:
          `${summary}\n\nGive 3 insights. Each has a short title (under 8 words), a one sentence detail with a concrete next action, and a tone: ` +
          "good (going well), watch (slipping) or act (needs attention now). Then one sentence 'focus' for this week.",
        fast: true,
        schema: {
          type: "OBJECT",
          properties: {
            insights: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { title: { type: "STRING" }, detail: { type: "STRING" }, tone: { type: "STRING", enum: ["good", "watch", "act"] } },
                required: ["title", "detail", "tone"],
              },
            },
            focus: { type: "STRING" },
          },
          required: ["insights", "focus"],
        },
      });
      return { insights: (data.insights ?? []).slice(0, 4), focus: data.focus ?? "", ai: true };
    } catch (e) {
      console.error("insights", e);
    }
  }
  return { ...ruleInsights(stats, mastery), ai: false };
}

function ruleInsights(stats: CourseStats[], mastery: Mastery[]): { insights: Insight[]; focus: string } {
  const out: Insight[] = [];
  const graded = stats.filter((s) => s.average != null);
  const best = [...graded].sort((a, b) => b.average! - a.average!)[0];
  const falling = [...stats].filter((s) => (s.trend ?? 0) <= -8).sort((a, b) => a.trend! - b.trend!)[0];
  const weakest = [...mastery].sort((a, b) => a.score - b.score)[0];
  if (falling) out.push({ title: `${falling.courseCode} is slipping`, detail: `Your latest mark is ${Math.abs(falling.trend!)} points below your earlier average. Review the feedback on it before the next one.`, tone: "act" });
  const late = stats.find((s) => s.late + s.missed > 0);
  if (late) out.push({ title: `Late work in ${late.courseCode}`, detail: `${late.late} late and ${late.missed} missed. Break the next one down early so it doesn't happen again.`, tone: "watch" });
  if (weakest && weakest.score < 60) out.push({ title: `Weak spot: ${weakest.topic}`, detail: `You're at ${weakest.score}% on ${weakest.topic}. Take another quiz after a short review.`, tone: "act" });
  if (best) out.push({ title: `Strong in ${best.courseCode}`, detail: `${best.average}% average. Keep the same routine there.`, tone: "good" });
  return { insights: out.slice(0, 3), focus: falling ? `Put extra time into ${falling.courseCode} this week.` : "Keep your plan steady and take one quiz on your weakest topic." };
}

// ---------- Quizzes ----------

export interface Question {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export async function makeQuiz(courseCode: string, topic: string, related: Assignment[]): Promise<Question[]> {
  if (!hasGemini()) return [];
  const context = related.slice(0, 4).map((a) => `- ${a.name}: ${plainText(a.description, 300)}`).join("\n");
  const { data } = await gemini<{ questions: Question[] }>({
    system: "You write short, accurate university-level practice quizzes. Each question tests understanding, not trivia.",
    prompt:
      `Course: ${courseCode}\nTopic: ${topic}\n${context ? `Course assignments for context:\n${context}\n` : ""}\n` +
      "Write 5 multiple-choice questions with 4 options each, one correct (answer is its 0-based index), and a one sentence explanation. Vary the difficulty from easy to hard.",
    schema: {
      type: "OBJECT",
      properties: {
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { q: { type: "STRING" }, options: { type: "ARRAY", items: { type: "STRING" } }, answer: { type: "INTEGER" }, explain: { type: "STRING" } },
            required: ["q", "options", "answer", "explain"],
          },
        },
      },
      required: ["questions"],
    },
    temperature: 0.8,
    fast: true, // the bigger models think for 20s+ on a quiz; Flash-Lite answers in a few seconds
  });
  return (data.questions ?? []).filter((q) => q.options?.length >= 2 && q.answer >= 0 && q.answer < q.options.length).slice(0, 5);
}

// New score blends the old one with the latest result, so one bad day doesn't erase progress.
export function updateMastery(prev: Mastery | null, courseCode: string, topic: string, key: string, result: number): Mastery {
  const score = Math.round(prev ? prev.score * 0.4 + result * 0.6 : result);
  return {
    key,
    courseCode,
    topic: prev?.topic ?? topic,
    score,
    attempts: (prev?.attempts ?? 0) + 1,
    history: [...(prev?.history ?? []), { at: new Date().toISOString(), score: Math.round(result) }].slice(-20),
  };
}

export const topicsFor = (mastery: Mastery[]) => mastery.map((m) => ({ courseCode: m.courseCode, topic: m.topic }));
