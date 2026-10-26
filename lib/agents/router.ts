import { gemini, hasGemini } from "../gemini";
import { dayKey } from "../planner";
import type { Assignment } from "../types";

// Command bar: one box for everything. Gemini picks which agent should handle the
// request (function calling) and extracts its arguments; the app then runs it.

export type Route =
  | { agent: "planner"; instruction: string }
  | { agent: "study"; courseCode: string }
  | { agent: "quiz"; courseCode: string; topic: string }
  | { agent: "open"; assignmentId: string }
  | { agent: "checkin"; energy: number; sleep: number | null; note: string }
  | { agent: "answer"; text: string };

const FUNCTIONS = [
  {
    name: "change_schedule",
    description: "The student describes availability: shifts, events, busy or free days, how many hours they can study.",
    parameters: { type: "OBJECT", properties: { instruction: { type: "STRING" } }, required: ["instruction"] },
  },
  {
    name: "check_in",
    description:
      "The student says how they feel today or how they slept: tired, exhausted, burnt out, stressed, sick, great, energized, slept 4 hours. Not for schedule changes on other days.",
    parameters: {
      type: "OBJECT",
      properties: {
        energy: { type: "INTEGER", description: "1 drained, 2 low, 3 okay, 4 good, 5 great" },
        sleepHours: { type: "NUMBER", description: "Hours slept last night, only if they said" },
        note: { type: "STRING", description: "What they said, briefly" },
      },
      required: ["energy"],
    },
  },
  {
    name: "open_study",
    description:
      "The student wants a course's notes or class recordings, or to study a course.",
    parameters: {
      type: "OBJECT",
      properties: { courseCode: { type: "STRING", description: "One of the student's course codes" } },
      required: ["courseCode"],
    },
  },
  {
    name: "quiz_me",
    description: "The student wants to test themselves or practice a topic.",
    parameters: { type: "OBJECT", properties: { courseCode: { type: "STRING" }, topic: { type: "STRING" } }, required: ["courseCode", "topic"] },
  },
  {
    name: "open_assignment",
    description: "The student refers to one of their assignments and wants to open or work on it.",
    parameters: { type: "OBJECT", properties: { assignmentId: { type: "STRING" } }, required: ["assignmentId"] },
  },
];

export async function route(text: string, assignments: Assignment[], context = ""): Promise<Route> {
  const courses = [...new Set(assignments.map((a) => a.courseCode))];
  if (hasGemini()) {
    try {
      const { data, call } = await gemini<string>({
        system:
          `You are Pace, a student's study assistant. Today is ${dayKey(new Date())}. Their courses: ${courses.join(", ")}. ` +
          `Open assignments:\n${assignments.filter((a) => !a.submitted).slice(0, 30).map((a) => `${a.id}: ${a.courseCode} ${a.name}`).join("\n")}\n` +
          (context ? `${context}\n` : "") +
          "Call the right function for the request. If none fits, answer briefly yourself (under 60 words) using the plan above.",
        prompt: text.slice(0, 800),
        functions: FUNCTIONS,
        fast: true,
        temperature: 0.2,
      });
      if (call) {
        const a = call.args as Record<string, unknown>;
        if (call.name === "change_schedule") return { agent: "planner", instruction: String(a.instruction ?? text) };
        if (call.name === "check_in")
          return { agent: "checkin", energy: Number(a.energy) || 3, sleep: a.sleepHours == null ? null : Number(a.sleepHours), note: String(a.note ?? text) };
        if (call.name === "open_study") return { agent: "study", courseCode: String(a.courseCode ?? "") };
        if (call.name === "quiz_me") return { agent: "quiz", courseCode: String(a.courseCode ?? ""), topic: String(a.topic ?? "") };
        if (call.name === "open_assignment" && assignments.some((x) => x.id === a.assignmentId)) return { agent: "open", assignmentId: String(a.assignmentId) };
      }
      if (data) return { agent: "answer", text: data.replace(/\*\*/g, "") };
    } catch (e) {
      console.error("router", e);
    }
  }
  return keywordRoute(text, assignments, courses);
}

function keywordRoute(text: string, assignments: Assignment[], courses: string[]): Route {
  const t = text.toLowerCase();
  const course = courses.find((c) => t.includes(c.toLowerCase())) ?? "";
  if (/\b(notes?|lectures?)\b/.test(t)) return { agent: "study", courseCode: course };
  if (/\b(tired|exhausted|drained|burnt? out|sick|stressed|slept)\b/.test(t)) {
    const sleep = t.match(/slept\s+(\d+(?:\.\d)?)/);
    return { agent: "checkin", energy: /exhausted|drained|burnt? out|sick/.test(t) ? 1 : 2, sleep: sleep ? Number(sleep[1]) : null, note: text };
  }
  if (/\b(quiz me|practice|test me)\b/.test(t)) return { agent: "quiz", courseCode: course, topic: "" };
  if (/\b(busy|shift|work|off|free|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/.test(t)) return { agent: "planner", instruction: text };
  const hit = assignments.find((a) => t.includes(a.name.toLowerCase()) || a.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => t.includes(w)));
  if (hit) return { agent: "open", assignmentId: hit.id };
  return { agent: "answer", text: "Try \"I work Tuesday 5 to 10\", \"Open my CSC263 notes\", or \"Quiz me on heaps\"." };
}
