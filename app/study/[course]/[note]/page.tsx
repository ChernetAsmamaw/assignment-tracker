import { notFound, redirect } from "next/navigation";
import { courseColor } from "@/lib/colors";
import { loadAll } from "@/lib/data";
import { hasGemini } from "@/lib/gemini";
import type { Lecture, LectureMine } from "@/lib/lectures";
import { getOne } from "@/lib/store";
import { courseFromParam, studyHref, type CourseStudy } from "@/lib/study";
import NoteView from "./NoteView";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ course: string; note: string }> }) {
  const { course, note } = await params;
  const code = courseFromParam(course);
  const [lecture, mine, { assignments }, study] = await Promise.all([
    getOne<Lecture>("lectures", note),
    getOne<LectureMine>("lecturemine", note),
    loadAll(),
    getOne<CourseStudy>("study", code),
  ]);
  if (!lecture) notFound();
  if (lecture.courseCode !== code) redirect(studyHref(lecture.courseCode, lecture.id));
  const courses = [...new Set(assignments.map((a) => a.courseCode))].sort();
  const concepts = (study?.concepts ?? [])
    .filter((c) => c.sources.some((s) => s.lectureId === lecture.id))
    .map(({ id, name, status }) => ({ id, name, status }));
  return <NoteView key={lecture.id} lecture={{ ...lecture, ...mine }} course={{ code, color: courseColor(code) }} courses={courses} concepts={concepts} gemini={hasGemini()} />;
}
