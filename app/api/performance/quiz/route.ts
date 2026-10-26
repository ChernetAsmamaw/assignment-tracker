import { NextResponse } from "next/server";
import { makeQuiz } from "@/lib/agents/performance";
import { getIncludedAssignments } from "@/lib/data";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { courseCode, topic } = (await req.json().catch(() => ({}))) as { courseCode?: string; topic?: string };
  if (!topic?.trim()) return NextResponse.json({ error: "Pick a topic" }, { status: 400 });
  try {
    const related = (await getIncludedAssignments()).filter((a) => a.courseCode === courseCode);
    return NextResponse.json({ questions: await makeQuiz(String(courseCode ?? ""), topic.trim().slice(0, 100), related) });
  } catch (e) {
    console.error("quiz", e);
    return NextResponse.json({ error: "Couldn't write a quiz right now. Try again." }, { status: 502 });
  }
}
