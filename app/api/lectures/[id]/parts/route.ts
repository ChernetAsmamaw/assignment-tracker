import { NextResponse } from "next/server";
import { writePart } from "@/lib/class-notes";
import { hasGemini } from "@/lib/gemini";
import { addPart, currentParts, nextWindow, type Lecture, type LectureMine, type LectureParts } from "@/lib/lectures";
import { getOne, putOne, saveError } from "@/lib/store";

export const maxDuration = 60;

// Notes for the next 10 minutes of class that have none yet. The page asks while the class
// records, so by the time it ends most of the notes are already written. reset starts over.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { reset } = (await req.json().catch(() => ({}))) as { reset?: boolean };
  const [lecture, mine, saved] = await Promise.all([
    getOne<Lecture>("lectures", id),
    getOne<LectureMine>("lecturemine", id),
    getOne<LectureParts>("lectureparts", id),
  ]);
  if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const kept = reset ? [] : currentParts(saved?.parts ?? [], lecture.segments);
  const title = saved?.title ?? "";
  const next = hasGemini() ? nextWindow(lecture.segments, kept) : null;
  if (!next) return NextResponse.json({ parts: kept, title, written: false });

  let made;
  try {
    made = await writePart({ ...lecture, myNotes: mine?.myNotes }, next, kept, title);
  } catch (e) {
    console.error("notes part", e);
    return NextResponse.json({ error: "Gemini couldn't write notes for this part of the class just now." }, { status: 502 });
  }
  // Add it to the parts saved by now, in case another one was saved meanwhile.
  const latest = reset ? [] : ((await getOne<LectureParts>("lectureparts", id))?.parts ?? []);
  const out: LectureParts = { parts: addPart(latest, made.part, lecture.segments), title: made.title || title };
  try {
    await putOne("lectureparts", id, out);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
  return NextResponse.json({ ...out, written: true });
}
