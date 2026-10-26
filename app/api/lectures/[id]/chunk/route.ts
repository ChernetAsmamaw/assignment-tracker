import { NextResponse } from "next/server";
import { transcribeChunk, type Lecture } from "@/lib/lectures";
import { getOne, putOne, saveError } from "@/lib/store";

export const maxDuration = 60;

// One recorded chunk (about a minute of audio). The recorder sends chunks one at a time, in order.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { audio?: string; mimeType?: string; offset?: number; length?: number; captions?: string };
  const offset = Math.max(0, Number(b.offset) || 0);
  const length = Math.min(600, Math.max(1, Number(b.length) || 60));
  const mimeType = String(b.mimeType ?? "audio/webm").split(";")[0];
  const audio = b.audio ? { mimeType, data: String(b.audio) } : null;

  // Transcribe before loading the lecture, so the read-modify-write below stays short.
  const { segments, ai } = await transcribeChunk(audio, offset, length, String(b.captions ?? "").slice(0, 20_000));

  const lecture = await getOne<Lecture>("lectures", id);
  if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A retried chunk replaces whatever was saved for the same window.
  lecture.segments = lecture.segments.filter((s) => s.start < offset || s.start >= offset + length);
  const before = lecture.segments.filter((s) => s.start < offset);
  const after = lecture.segments.filter((s) => s.start >= offset + length);
  let n = Math.max(0, ...lecture.segments.map((s) => Number(s.id.slice(1)) || 0));
  const added = segments.map((s) => ({ id: `s${++n}`, ...s }));
  lecture.segments = [...before, ...added, ...after];
  lecture.duration = Math.max(lecture.duration, offset + length);
  try {
    await putOne("lectures", id, lecture);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
  return NextResponse.json({ segments: added, duration: lecture.duration, ai });
}
