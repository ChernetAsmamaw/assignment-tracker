import { notFound } from "next/navigation";
import { getAssignments } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { hasGemini } from "@/lib/gemini";
import type { Lecture } from "@/lib/lectures";
import { getOne } from "@/lib/store";
import LectureView from "./LectureView";

export const dynamic = "force-dynamic";

export default async function LecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lecture, assignments] = await Promise.all([getOne<Lecture>("lectures", id), getAssignments().catch(() => [])]);
  if (!lecture) notFound();
  const courses = [...new Set(assignments.map((a) => a.courseCode))].sort();
  return <LectureView lecture={lecture} courses={courses} color={courseColor(lecture.courseCode)} gemini={hasGemini()} />;
}
