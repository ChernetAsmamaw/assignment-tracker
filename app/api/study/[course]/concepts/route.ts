import { NextResponse } from "next/server";
import { getAssignments } from "@/lib/canvas";
import type { Lecture } from "@/lib/lectures";
import { getOne, listAll, putOne } from "@/lib/store";
import { buildConcepts, courseFromParam, keepEdits, type CourseStudy } from "@/lib/study";

export const maxDuration = 60;

// Rebuild a course's concepts from its class notes and the assignments that are still open.
export async function POST(_req: Request, { params }: { params: Promise<{ course: string }> }) {
  const code = courseFromParam((await params).course);
  const [lectures, assignments, prev] = await Promise.all([listAll<Lecture>("lectures"), getAssignments(), getOne<CourseStudy>("study", code)]);
  const mine = Object.values(lectures)
    .filter((l) => l.courseCode === code)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const built = await buildConcepts(code, mine, assignments.filter((a) => a.courseCode === code), prev);
  const study = keepEdits(built, prev, await getOne<CourseStudy>("study", code));
  await putOne("study", code, study);
  return NextResponse.json(study);
}
