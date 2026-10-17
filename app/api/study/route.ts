import { NextResponse } from "next/server";
import { createStudyPlan } from "@/lib/agents/study";
import { getAssignments } from "@/lib/canvas";
import { listAll, putOne } from "@/lib/store";
import type { Mastery } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; courseCode?: string; examAt?: string; topics?: string[] | string; notes?: string };
  const examAt = b.examAt ? new Date(b.examAt) : null;
  if (!examAt || isNaN(examAt.getTime()) || examAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Pick an exam date in the future" }, { status: 400 });
  }
  const topics = Array.isArray(b.topics) ? b.topics : String(b.topics ?? "").split(/[,\n]/);
  const courseCode = String(b.courseCode ?? "").trim();
  const [assignments, mastery] = await Promise.all([getAssignments(), listAll<Mastery>("mastery")]);
  const plan = await createStudyPlan(
    { title: String(b.title ?? "Exam"), courseCode, examAt: examAt.toISOString(), topics, notes: String(b.notes ?? "") },
    assignments.filter((a) => a.courseCode === courseCode),
    mastery,
  );
  await putOne("studyplans", plan.id, plan);
  return NextResponse.json(plan);
}
