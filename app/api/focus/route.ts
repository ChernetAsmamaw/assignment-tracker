import { NextResponse } from "next/server";
import { dayKey } from "@/lib/planner";
import { getProgress, putOne, saveProgress } from "@/lib/store";
import { percentFromSteps } from "@/lib/types";
import type { FocusSession } from "@/lib/wellbeing";

// Logs a focus block. Finished blocks teach the planner your pace; "step done" also checks off
// the matching step on the assignment.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<FocusSession> & { stepDone?: boolean };
  if (!b.assignmentId || typeof b.minutes !== "number") return NextResponse.json({ error: "Missing session" }, { status: 400 });
  const now = new Date();
  const s: FocusSession = {
    id: crypto.randomUUID(),
    date: dayKey(now),
    at: now.toISOString(),
    assignmentId: String(b.assignmentId),
    courseCode: String(b.courseCode ?? "").slice(0, 40),
    title: String(b.title ?? "").slice(0, 200),
    plannedMinutes: Math.min(16 * 60, Math.max(0, Math.round(Number(b.plannedMinutes) || 0))),
    minutes: Math.min(16 * 60, Math.max(0, Math.round(b.minutes))),
    completed: !!b.completed,
  };
  if (s.minutes < 1) return NextResponse.json({ saved: false });
  await putOne("focus", s.id, s);

  if (b.stepDone) {
    const p = await getProgress(s.assignmentId);
    const step = p.steps.find((x) => !x.done && x.title === s.title);
    if (step) {
      step.done = true;
      const percent = percentFromSteps(p.steps);
      await saveProgress(s.assignmentId, { ...p, percent, status: percent >= 100 ? "done" : "in_progress" });
    }
  }
  return NextResponse.json({ saved: true });
}
