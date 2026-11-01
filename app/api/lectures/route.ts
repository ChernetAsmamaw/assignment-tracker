import { NextResponse } from "next/server";
import { isDay } from "@/lib/format";
import { newLecture } from "@/lib/lectures";
import { putOne, saveError } from "@/lib/store";

// A new note in a course, dated today unless a date is given.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; courseCode?: string; date?: string };
  const courseCode = String(b.courseCode ?? "").trim();
  if (!courseCode) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
  const lecture = newLecture(String(b.title ?? ""), courseCode, isDay(b.date) ? b.date : undefined);
  try {
    await putOne("lectures", lecture.id, lecture);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
  return NextResponse.json(lecture);
}
