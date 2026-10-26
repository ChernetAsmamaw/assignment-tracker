import { gemini, hasGemini, plainText } from "../gemini";
import { dayKey, KIND_LABEL } from "../planner";
import type { Assignment, Mastery, SessionKind, StudyPlan, StudySession } from "../types";
import { masteryKey } from "../types";

// Study Plan agent: turns "midterm on the 28th, these topics" into a dated timeline.
// The spacing is deterministic and evidence-based (learn, then review at +1/+3/+7 days,
// mixed practice near the end, a mock exam two days out). Gemini fills in what to
// actually do in each session and, when no topics are given, works them out.

const DAY = 24 * 60 * 60 * 1000;
const MINUTES: Record<SessionKind, number> = { learn: 60, review: 30, practice: 60, mock: 90 };

export interface StudyRequest {
  title: string;
  courseCode: string;
  examAt: string;
  topics: string[];
  notes: string; // anything pasted: syllabus section, exam coverage, what feels weak
}

const id = () => Math.random().toString(36).slice(2, 10);

export function scheduleSessions(topics: string[], examAt: string, mastery: Record<string, Mastery>, courseCode: string, now = new Date()): StudySession[] {
  const exam = new Date(examAt);
  const dates: string[] = [];
  for (let t = now.getTime(); dayKey(t) < dayKey(exam); t += DAY) dates.push(dayKey(t));
  if (dates.length === 0) dates.push(dayKey(now));
  const n = dates.length;

  // Weakest topics first, so they get the most reviews.
  const ordered = [...topics].sort(
    (a, b) => (mastery[masteryKey(courseCode, a)]?.score ?? 50) - (mastery[masteryKey(courseCode, b)]?.score ?? 50),
  );

  const byDate = new Map<string, Map<SessionKind, string[]>>();
  const add = (i: number, kind: SessionKind, topic: string) => {
    const d = dates[Math.min(Math.max(i, 0), n - 1)];
    const kinds = byDate.get(d) ?? new Map<SessionKind, string[]>();
    const list = kinds.get(kind) ?? [];
    if (!list.includes(topic)) list.push(topic);
    kinds.set(kind, list);
    byDate.set(d, kinds);
  };

  const mockIdx = n >= 4 ? n - 2 : -1;
  const learnSpan = Math.max(1, Math.floor(n * (n >= 6 ? 0.5 : 0.7)));
  ordered.forEach((topic, i) => {
    const learnAt = Math.floor((i * learnSpan) / Math.max(ordered.length, 1));
    add(learnAt, "learn", topic);
    for (const gap of [1, 3, 7]) {
      const at = learnAt + gap;
      if (at < n - 1 && at !== mockIdx) add(at, "review", topic);
    }
  });
  // Mixed practice in the last third, a mock exam, and a light final review.
  const practiceFrom = Math.max(learnSpan, Math.floor(n * 0.66));
  for (let i = practiceFrom; i < n - 1; i++) if (i !== mockIdx) ordered.slice(0, 3).forEach((t) => add(i, "practice", t));
  if (mockIdx >= 0) ordered.forEach((t) => add(mockIdx, "mock", t));
  if (n >= 2) ordered.slice(0, 4).forEach((t) => add(n - 1, "review", t));

  const sessions: StudySession[] = [];
  for (const d of dates) {
    const kinds = byDate.get(d);
    if (!kinds) continue;
    for (const kind of ["learn", "practice", "mock", "review"] as SessionKind[]) {
      const ts = kinds.get(kind);
      if (!ts?.length) continue;
      const minutes = kind === "review" ? Math.min(60, 15 + ts.length * 10) : kind === "learn" ? MINUTES.learn * Math.min(ts.length, 2) : MINUTES[kind];
      sessions.push({ id: id(), date: d, kind, topics: ts, minutes, activities: [], done: false });
    }
  }
  return sessions;
}

const DEFAULT_ACTIVITIES: Record<SessionKind, string[]> = {
  learn: ["Skim the lecture slides, then close them and write the key ideas from memory", "Work two textbook examples without looking at the solution"],
  review: ["Blurt: write everything you remember, then check your notes for gaps", "Redo one problem you got wrong before"],
  practice: ["Do past-exam questions under time pressure", "Mix topics: don't do all questions of one kind in a row"],
  mock: ["Sit a full past exam, timed, closed book", "Mark it honestly and list the topics you lost marks on"],
};

export async function createStudyPlan(req: StudyRequest, related: Assignment[], mastery: Record<string, Mastery>): Promise<StudyPlan> {
  let topics = req.topics.map((t) => t.trim()).filter(Boolean).slice(0, 10);
  let summary = "";
  const context = [
    `Course: ${req.courseCode}`,
    `Exam: ${req.title} on ${new Date(req.examAt).toDateString()}`,
    req.notes ? `Student's notes:\n${req.notes.slice(0, 3000)}` : "",
    related.length ? `Recent assignments in this course:\n${related.slice(0, 6).map((a) => `- ${a.name}: ${plainText(a.description, 400)}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!topics.length && hasGemini()) {
    try {
      const { data } = await gemini<{ topics: string[] }>({
        system: "You help university students prepare for exams.",
        prompt: `${context}\n\nList the 3 to 8 topics this exam most likely covers, as short names (2 to 5 words).`,
        fast: true,
        schema: { type: "OBJECT", properties: { topics: { type: "ARRAY", items: { type: "STRING" } } }, required: ["topics"] },
      });
      topics = (data.topics ?? []).slice(0, 8);
    } catch (e) {
      console.error("study topics", e);
    }
  }
  if (!topics.length) topics = ["Lecture material", "Practice problems", "Past exams"];

  const sessions = scheduleSessions(topics, req.examAt, mastery, req.courseCode);

  if (hasGemini()) {
    try {
      const { data } = await gemini<{ summary: string; sessions: { n: number; activities: string[] }[] }>({
        system:
          "You are a study coach who uses evidence-based techniques: active recall, spaced repetition, interleaving and practice testing. " +
          "Activities are concrete and specific to the course topics, each under 120 characters.",
        prompt:
          `${context}\n\nHere is the session timeline. For each session number, give 2 or 3 concrete activities for that session's kind and topics. ` +
          "Also write a 2 sentence summary of the strategy.\n\n" +
          sessions.map((s, i) => `${i}: ${s.date} · ${KIND_LABEL[s.kind]} · ${s.minutes} min · ${s.topics.join(", ")}`).join("\n"),
        schema: {
          type: "OBJECT",
          properties: {
            summary: { type: "STRING" },
            sessions: {
              type: "ARRAY",
              items: { type: "OBJECT", properties: { n: { type: "INTEGER" }, activities: { type: "ARRAY", items: { type: "STRING" } } }, required: ["n", "activities"] },
            },
          },
          required: ["summary", "sessions"],
        },
      });
      summary = data.summary ?? "";
      for (const s of data.sessions ?? []) if (sessions[s.n]) sessions[s.n].activities = (s.activities ?? []).slice(0, 3).map((a) => String(a).slice(0, 200));
    } catch (e) {
      console.error("study activities", e);
    }
  }
  for (const s of sessions) if (!s.activities.length) s.activities = DEFAULT_ACTIVITIES[s.kind];
  if (!summary) summary = "Each topic is learned once, then reviewed 1, 3 and 7 days later so it sticks. The last stretch mixes topics with timed practice and a full mock exam.";

  return {
    id: id(),
    title: req.title.slice(0, 120) || "Exam",
    courseCode: req.courseCode.slice(0, 20),
    examAt: req.examAt,
    topics,
    sessions,
    summary,
    createdAt: new Date().toISOString(),
  };
}
