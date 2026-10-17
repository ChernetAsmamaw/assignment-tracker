import { NextResponse } from "next/server";
import { getOne, putOne } from "@/lib/store";
import type { StudyPlan } from "@/lib/types";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getOne<StudyPlan>("studyplans", id);
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sessionId, done } = (await req.json().catch(() => ({}))) as { sessionId?: string; done?: boolean };
  plan.sessions = plan.sessions.map((s) => (s.id === sessionId ? { ...s, done: !!done } : s));
  await putOne("studyplans", id, plan);
  return NextResponse.json(plan);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await putOne("studyplans", id, null);
  return NextResponse.json({ ok: true });
}
