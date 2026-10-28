import { notFound, redirect } from "next/navigation";
import { getAssignments } from "@/lib/canvas";
import { hasGemini } from "@/lib/gemini";
import { currentParts, type Lecture, type LectureMine, type LectureParts } from "@/lib/lectures";
import { getOne } from "@/lib/store";
import { courseFromParam, studyHref } from "@/lib/study";
import NoteView from "./NoteView";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ course: string; note: string }> }) {
  const { course, note } = await params;
  const code = courseFromParam(course);
  const [lecture, mine, saved, assignments] = await Promise.all([
    getOne<Lecture>("lectures", note),
    getOne<LectureMine>("lecturemine", note),
    getOne<LectureParts>("lectureparts", note),
    getAssignments(),
  ]);
  if (!lecture) notFound();
  if (lecture.courseCode !== code) redirect(studyHref(lecture.courseCode, lecture.id));
  const courses = [...new Set(assignments.map((a) => a.courseCode))].sort();
  return (
    <NoteView
      key={lecture.id}
      lecture={{ ...lecture, ...mine }}
      parts={currentParts(saved?.parts ?? [], lecture.segments)}
      courses={courses}
      gemini={hasGemini()}
    />
  );
}
