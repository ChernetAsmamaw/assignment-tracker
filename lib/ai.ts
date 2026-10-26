import { gemini, hasGemini, plainText } from "./gemini";
import { formatDue } from "./format";
import { fmtHours, guessHours, PRESSURE_LABEL, type Plan } from "./planner";
import type { Settings } from "./store";
import type { Assignment, Progress } from "./types";

// Gemini-powered features. Each one falls back to a simple rule-based answer so
// the app (and a live demo) never breaks when the API key is missing or Gemini fails.

const COACH =
  "You are Pace, a study coach for a University of Toronto student. You turn course assignments into realistic, " +
  "concrete plans and protect the student's wellbeing (sleep, rest days, no all-nighters). You help them plan, " +
  "understand and find sources; you never write the graded work for them.";

const describe = (a: Assignment) =>
  [
    `Assignment: ${a.name}`,
    `Course: ${a.course}`,
    `Due: ${formatDue(a.dueAt)}`,
    a.points != null ? `Worth: ${a.points} points` : "",
    a.submissionTypes.length ? `Submitted as: ${a.submissionTypes.join(", ")}` : "",
    a.isGroup ? "Group assignment" : "Individual assignment",
    `Instructions from Quercus:\n${plainText(a.description) || "(none provided)"}`,
  ]
    .filter(Boolean)
    .join("\n");

// ---------- Break an assignment into steps ----------

export interface Breakdown {
  steps: { title: string; hours: number }[];
  approach: string;
  watchOuts: string[];
  ai: boolean;
}

export async function breakdown(a: Assignment): Promise<Breakdown> {
  if (hasGemini()) {
    try {
      const { data } = await gemini<Omit<Breakdown, "ai">>({
        system: COACH,
        prompt:
          `${describe(a)}\n\nBreak this assignment into 3 to 8 ordered steps a student can check off. ` +
          "Each step title is a short imperative (under 70 characters) specific to these instructions, not generic. " +
          "Estimate realistic hours per step for an average undergraduate (0.25 to 6 hours each). " +
          "Give a 1 to 2 sentence approach, and up to 3 easy-to-miss requirements from the instructions as watchOuts.",
        schema: {
          type: "OBJECT",
          properties: {
            steps: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { title: { type: "STRING" }, hours: { type: "NUMBER" } },
                required: ["title", "hours"],
              },
            },
            approach: { type: "STRING" },
            watchOuts: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["steps", "approach", "watchOuts"],
        },
      });
      const steps = (data.steps ?? [])
        .slice(0, 10)
        .map((s) => ({ title: String(s.title).slice(0, 120), hours: clampHours(s.hours) }))
        .filter((s) => s.title);
      if (steps.length) return { steps, approach: data.approach ?? "", watchOuts: (data.watchOuts ?? []).slice(0, 3), ai: true };
    } catch (e) {
      console.error("breakdown", e);
    }
  }
  return { ...templateSteps(a), ai: false };
}

const clampHours = (h: unknown) => Math.min(8, Math.max(0.25, Math.round((Number(h) || 1) * 4) / 4));

function templateSteps(a: Assignment): Omit<Breakdown, "ai"> {
  const total = guessHours(a);
  const parts: [string, number][] = /essay|paper|report|proposal/i.test(a.name)
    ? [["Read the instructions and rubric", 0.1], ["Research and collect sources", 0.3], ["Outline the argument", 0.15], ["Write the first draft", 0.3], ["Revise, cite and submit", 0.15]]
    : [["Read the instructions and rubric", 0.1], ["Review the related lecture material", 0.25], ["Do the main work", 0.5], ["Check against the rubric and submit", 0.15]];
  return {
    steps: parts.map(([title, share]) => ({ title, hours: clampHours(total * share) })),
    approach: "A general plan. Add a Gemini API key for steps tailored to this assignment's instructions.",
    watchOuts: [],
  };
}

// ---------- Estimate hours for many assignments at once ----------

export async function estimateHours(list: Assignment[]): Promise<Record<string, number>> {
  if (!hasGemini() || list.length === 0) return {};
  const { data } = await gemini<{ id: string; hours: number }[]>({
    system: COACH,
    prompt:
      "Estimate the total hours an average undergraduate needs to complete each assignment below, including reading, " +
      "research, doing the work and checking it. Return one entry per id.\n\n" +
      list.map((a) => `--- id: ${a.id}\n${describe(a).slice(0, 1500)}`).join("\n\n"),
    fast: true,
    schema: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { id: { type: "STRING" }, hours: { type: "NUMBER" } }, required: ["id", "hours"] },
    },
  });
  const ids = new Set(list.map((a) => a.id));
  return Object.fromEntries(
    (data ?? []).filter((e) => ids.has(String(e.id))).map((e) => [String(e.id), Math.min(40, Math.max(0.5, Math.round(Number(e.hours) * 2) / 2 || 1))]),
  );
}

// ---------- Find resources ----------

export interface Suggestion {
  title: string;
  url: string;
  note: string;
}

export async function suggestResources(a: Assignment): Promise<{ concepts: string[]; items: Suggestion[]; ai: boolean }> {
  const fromQuercus = linksIn(a.description).map((l) => ({ ...l, note: "Linked in the Quercus instructions" }));
  if (hasGemini()) {
    try {
      const { data } = await gemini<{ concepts: { name: string; why: string; query: string }[] }>({
        system: COACH,
        prompt:
          `${describe(a)}\n\nList the 3 to 6 key concepts or skills the student needs for this assignment. ` +
          "For each, say in one sentence why it matters here, and give a precise search query (under 8 words) that would find a good explainer or source.",
        fast: true,
        schema: {
          type: "OBJECT",
          properties: {
            concepts: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { name: { type: "STRING" }, why: { type: "STRING" }, query: { type: "STRING" } },
                required: ["name", "why", "query"],
              },
            },
          },
          required: ["concepts"],
        },
      });
      const concepts = (data.concepts ?? []).slice(0, 6);
      const items = concepts.flatMap((c) => [
        { title: `${c.name}: video explainers`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(c.query)}`, note: c.why },
        { title: `${c.name}: scholarly sources`, url: `https://scholar.google.com/scholar?q=${encodeURIComponent(c.query)}`, note: c.why },
      ]);
      return { concepts: concepts.map((c) => c.name), items: [...fromQuercus, ...items], ai: true };
    } catch (e) {
      console.error("resources", e);
    }
  }
  const q = encodeURIComponent(`${a.courseCode} ${a.name}`);
  return {
    concepts: [],
    items: [...fromQuercus, { title: `Search: ${a.courseCode} ${a.name}`, url: `https://www.google.com/search?q=${q}`, note: "General search" }],
    ai: false,
  };
}

function linksIn(html: string | null): { title: string; url: string }[] {
  if (!html) return [];
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a[^>]+href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = plainText(m[2]).slice(0, 120) || m[1];
    if (!out.has(m[1])) out.set(m[1], title);
  }
  return [...out].slice(0, 8).map(([url, title]) => ({ url, title }));
}

// ---------- Ask about an assignment ----------

export async function ask(a: Assignment, p: Progress, question: string): Promise<string> {
  if (!hasGemini()) return "Add a Gemini API key (GEMINI_API_KEY) to ask questions about this assignment.";
  const steps = p.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.title} (${s.hours}h)`).join("\n");
  const { data } = await gemini<string>({
    system:
      COACH +
      " Answer questions about the assignment using its instructions. Be brief (under 150 words), use plain text with short " +
      "lists if useful. If the instructions don't say, say so and suggest asking the instructor or TA. Explain concepts, but don't produce the graded answer.",
    prompt: `${describe(a)}\n\nStudent's progress: ${p.percent}%${steps ? `\nTheir steps:\n${steps}` : ""}${p.notes ? `\nTheir notes:\n${p.notes.slice(0, 2000)}` : ""}\n\nQuestion: ${question}`,
  });
  return data;
}

// ---------- Weekly coach message ----------

export interface Coaching {
  headline: string;
  message: string;
  tips: string[];
  ai: boolean;
}

export async function coach(plan: Plan, settings: Settings): Promise<Coaching> {
  const summary = [
    `Workload status: ${PRESSURE_LABEL[plan.pressure]}`,
    `Planned work next 7 days: ${plan.next7Hours}h of ${plan.next7Capacity}h available (weekdays ${settings.weekdayHours}h, weekends ${settings.weekendHours}h)`,
    `Days at or over capacity this week: ${plan.fullDays}. Rest day this week: ${plan.restDay ? "yes" : "no"}.`,
    plan.risks.length ? `At risk: ${plan.risks.map((r) => `${r.name} (${r.courseCode}${r.overdue ? ", overdue" : `, ${fmtHours(r.overflowHours)} won't fit before it's due`})`).join("; ")}` : "Nothing at risk.",
    "Day by day:",
    ...plan.days.slice(0, 7).map((d) => `${d.label}: ${fmtHours(d.load)} / ${fmtHours(d.capacity)}${d.items.length ? ` (${d.items.map((i) => `${i.courseCode} ${i.name}: ${i.title} ${fmtHours(i.hours)}`).join("; ")})` : ""}`),
  ].join("\n");

  if (hasGemini()) {
    try {
      const { data } = await gemini<Omit<Coaching, "ai">>({
        system: COACH,
        prompt:
          `${summary}\n\nWrite a short coaching note for this week. headline: under 10 words. message: 2 to 3 sentences, ` +
          "specific about which days and assignments matter most. tips: 2 to 3 concrete actions (e.g. start X on Tuesday, " +
          "ask for an extension on Y, protect Sunday as a rest day). Be warm and direct; don't repeat the numbers verbatim.",
        fast: true,
        schema: {
          type: "OBJECT",
          properties: { headline: { type: "STRING" }, message: { type: "STRING" }, tips: { type: "ARRAY", items: { type: "STRING" } } },
          required: ["headline", "message", "tips"],
        },
        temperature: 0.7,
      });
      return { headline: data.headline, message: data.message, tips: (data.tips ?? []).slice(0, 3), ai: true };
    } catch (e) {
      console.error("coach", e);
    }
  }
  return { ...ruleCoach(plan), ai: false };
}

function ruleCoach(plan: Plan): Omit<Coaching, "ai"> {
  const busiest = plan.days.slice(0, 7).reduce((m, d) => (d.load > m.load ? d : m), plan.days[0]);
  const tips: string[] = [];
  const late = plan.risks.find((r) => r.overflowHours > 0);
  if (late) tips.push(`${late.name} needs about ${fmtHours(late.overflowHours)} more than you have before it's due. Start today or ask about an extension.`);
  if (busiest.load > 0) tips.push(`${busiest.label} is your heaviest day (${fmtHours(busiest.load)}). Pull some of it earlier.`);
  if (!plan.restDay) tips.push("You have no light day this week. Block off one evening to rest.");
  const headline = { calm: "You're on top of things", busy: "A full week, but it fits", crunch: "Tight week ahead", overloaded: "This week doesn't fit yet" }[plan.pressure];
  return {
    headline,
    message: `You have ${fmtHours(plan.next7Hours)} of work planned over the next 7 days and ${fmtHours(plan.next7Capacity)} available.`,
    tips,
  };
}
