import { NextResponse } from "next/server";
import { newLecture, type Lecture } from "@/lib/lectures";
import { putOne } from "@/lib/store";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; courseCode?: string };
  const courseCode = String(b.courseCode ?? "").trim();
  if (!courseCode) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
  const lecture: Lecture = newLecture(String(b.title ?? ""), courseCode);
  await putOne("lectures", lecture.id, lecture);
  return NextResponse.json(lecture);
}
