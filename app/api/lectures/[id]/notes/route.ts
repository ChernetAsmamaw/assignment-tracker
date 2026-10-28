import { NextResponse } from "next/server";
import { finishNotes } from "@/lib/class-notes";
import { currentParts, type Lecture, type LectureMine, type LectureParts } from "@/lib/lectures";
import { getOne, putOne, saveError } from "@/lib/store";

export const maxDuration = 60;

// The finished notes for a class: put together from the parts written while it recorded, or
// written in one go from a short transcript. They name the note too, unless you named it.
// fresh: start over instead of using the parts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { fresh } = (await req.json().catch(() => ({}))) as { fresh?: boolean };
  const [lecture, mine, saved] = await Promise.all([
    getOne<Lecture>("lectures", id),
    getOne<LectureMine>("lecturemine", id),
    getOne<LectureParts>("lectureparts", id),
  ]);
  if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!lecture.segments.length) return NextResponse.json({ error: "There's no transcript yet." }, { status: 400 });
  const done = await finishNotes({ ...lecture, myNotes: mine?.myNotes }, saved?.parts ?? [], { fresh, title: saved?.title });

  // Save onto the latest copy, in case more transcript arrived while the notes were written.
  const latest = (await getOne<Lecture>("lectures", id)) ?? lecture;
  latest.notes = done.notes;
  if (done.title && (!latest.title.trim() || latest.titleAuto)) Object.assign(latest, { title: done.title, titleAuto: true });
  try {
    await Promise.all([
      putOne("lectures", id, latest),
      done.parts && putOne<LectureParts>("lectureparts", id, { parts: done.parts, title: done.title || saved?.title }),
    ]);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
  return NextResponse.json({
    notes: done.notes,
    title: latest.title,
    titleAuto: !!latest.titleAuto,
    parts: done.parts ?? currentParts(saved?.parts ?? [], lecture.segments),
  });
}
