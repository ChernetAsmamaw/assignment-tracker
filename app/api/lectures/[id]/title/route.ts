import { NextResponse } from "next/server";
import { nameNote } from "@/lib/class-notes";
import type { Lecture, LectureMine, LectureParts } from "@/lib/lectures";
import { getOne, putOne, saveError } from "@/lib/store";

export const maxDuration = 30;

// Names an untitled note from what's on it. A title you typed is never replaced.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lecture, mine, saved] = await Promise.all([
    getOne<Lecture>("lectures", id),
    getOne<LectureMine>("lecturemine", id),
    getOne<LectureParts>("lectureparts", id),
  ]);
  if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lecture.title.trim() && !lecture.titleAuto) return NextResponse.json({ title: lecture.title, titleAuto: false });
  // A class recording already has a title from its notes so far.
  const title = (lecture.segments.length && saved?.title) || (await nameNote({ ...lecture, myNotes: mine?.myNotes }));
  if (!title) return NextResponse.json({ title: lecture.title, titleAuto: !!lecture.titleAuto });

  const latest = (await getOne<Lecture>("lectures", id)) ?? lecture;
  if (latest.title.trim() && !latest.titleAuto) return NextResponse.json({ title: latest.title, titleAuto: false });
  Object.assign(latest, { title, titleAuto: true });
  try {
    await putOne("lectures", id, latest);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
  return NextResponse.json({ title, titleAuto: true });
}
