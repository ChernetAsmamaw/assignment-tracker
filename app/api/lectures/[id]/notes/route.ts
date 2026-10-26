import { NextResponse } from "next/server";
import { writeNotes, type Lecture, type LectureMine } from "@/lib/lectures";
import { getOne, putOne } from "@/lib/store";

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lecture, mine] = await Promise.all([getOne<Lecture>("lectures", id), getOne<LectureMine>("lecturemine", id)]);
  if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!lecture.segments.length) return NextResponse.json({ error: "There's no transcript yet." }, { status: 400 });
  const notes = await writeNotes({ ...lecture, myNotes: mine?.myNotes });
  // Save onto the latest copy, in case more transcript arrived while the notes were written.
  const latest = (await getOne<Lecture>("lectures", id)) ?? lecture;
  latest.notes = notes;
  await putOne("lectures", id, latest);
  return NextResponse.json(notes);
}
