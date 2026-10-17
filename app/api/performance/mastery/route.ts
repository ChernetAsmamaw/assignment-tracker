import { NextResponse } from "next/server";
import { updateMastery } from "@/lib/agents/performance";
import { getOne, putOne } from "@/lib/store";
import { masteryKey, type Mastery } from "@/lib/types";

export async function POST(req: Request) {
  const { courseCode, topic, result } = (await req.json().catch(() => ({}))) as { courseCode?: string; topic?: string; result?: number };
  if (!topic?.trim() || typeof result !== "number") return NextResponse.json({ error: "Missing topic or result" }, { status: 400 });
  const course = String(courseCode ?? "").slice(0, 20);
  const key = masteryKey(course, topic);
  const next = updateMastery(await getOne<Mastery>("mastery", key), course, topic.trim().slice(0, 100), key, Math.min(100, Math.max(0, result)));
  await putOne("mastery", key, next);
  return NextResponse.json(next);
}
