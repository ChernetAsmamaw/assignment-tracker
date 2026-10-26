import { NextResponse } from "next/server";
import { newLecture, type Lecture } from "@/lib/lectures";
import { putOne } from "@/lib/store";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; courseCode?: string };
  const lecture: Lecture = newLecture(String(b.title ?? ""), String(b.courseCode ?? ""));
  await putOne("lectures", lecture.id, lecture);
  return NextResponse.json(lecture);
}
