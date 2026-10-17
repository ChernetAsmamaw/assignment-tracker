import { gemini, hasGemini } from "../gemini";
import { dayKey } from "../planner";
import type { Assignment } from "../types";

// Command bar: one box for everything. Gemini picks which agent should handle the
// request (function calling) and extracts its arguments; the app then runs it.

export type Route =
  | { agent: "planner"; instruction: string }
  | { agent: "study"; courseCode: string; title: string; examDate: string; topics: string[] }
  | { agent: "quiz"; courseCode: string; topic: string }
  | { agent: "open"; assignmentId: string }
  | { agent: "answer"; text: string };

const FUNCTIONS = [
  {
    name: "change_schedule",
    description: "The student describes availability: shifts, events, busy or free days, how many hours they can study.",
    parameters: { type: "OBJECT", properties: { instruction: { type: "STRING" } }, required: ["instruction"] },
  },
  {
    name: "create_study_plan",
    description: "Make a study timeline for an upcoming exam, midterm, test or quiz.",
    parameters: {
      type: "OBJECT",
      properties: {
        courseCode: { type: "STRING", description: "One of the student's course codes" },
        title: { type: "STRING", description: "e.g. Midterm 2" },
        examDate: { type: "STRING", description: "YYYY-MM-DD" },
        topics: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["courseCode", "title", "examDate"],
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
        temperature: 0.2,
      });
      if (call) {
        const a = call.args as Record<string, unknown>;
        if (call.name === "change_schedule") return { agent: "planner", instruction: String(a.instruction ?? text) };
        if (call.name === "create_study_plan")
          return { agent: "study", courseCode: String(a.courseCode ?? courses[0] ?? ""), title: String(a.title ?? "Exam"), examDate: String(a.examDate ?? ""), topics: (a.topics as string[]) ?? [] };
        if (call.name === "quiz_me") return { agent: "quiz", courseCode: String(a.courseCode ?? ""), topic: String(a.topic ?? "") };
        if (call.name === "open_assignment" && assignments.some((x) => x.id === a.assignmentId)) return { agent: "open", assignmentId: String(a.assignmentId) };
      }
      if (data) return { agent: "answer", text: data };
    } catch (e) {
      console.error("router", e);
    }
  }
  return keywordRoute(text, assignments, courses);
}

function keywordRoute(text: string, assignments: Assignment[], courses: string[]): Route {
  const t = text.toLowerCase();
  const course = courses.find((c) => t.includes(c.toLowerCase())) ?? "";
  if (/\b(exam|midterm|final|test)\b/.test(t)) return { agent: "study", courseCode: course || courses[0] || "", title: "Exam", examDate: "", topics: [] };
  if (/\b(quiz me|practice|test me)\b/.test(t)) return { agent: "quiz", courseCode: course, topic: "" };
  if (/\b(busy|shift|work|off|free|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/.test(t)) return { agent: "planner", instruction: text };
  const hit = assignments.find((a) => t.includes(a.name.toLowerCase()) || a.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => t.includes(w)));
  if (hit) return { agent: "open", assignmentId: hit.id };
  return { agent: "answer", text: "Try \"I work Tuesday 5 to 10\", \"Midterm in CSC263 on the 28th\", or \"Quiz me on heaps\"." };
}
