import { notFound, redirect } from "next/navigation";
import type { Lecture } from "@/lib/lectures";
import { getOne } from "@/lib/store";
import { studyHref } from "@/lib/study";

export const dynamic = "force-dynamic";

// Old links to a class keep working: its notes now live under its course in Study.
export default async function OldLecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lecture = await getOne<Lecture>("lectures", id);
  if (!lecture) notFound();
  redirect(studyHref(lecture.courseCode, lecture.id));
}
