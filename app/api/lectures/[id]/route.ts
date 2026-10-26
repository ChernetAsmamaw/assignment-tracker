import { NextResponse } from "next/server";
import { segmentsFromText, type Lecture } from "@/lib/lectures";
import { getOne, putOne } from "@/lib/store";

// Rename, move to another course, or add a pasted transcript.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lecture = await getOne<Lecture>("lectures", id);
  if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { title?: string; courseCode?: string; transcript?: string };
  if (b.title != null) lecture.title = String(b.title).trim() || lecture.title;
  if (b.courseCode != null) lecture.courseCode = String(b.courseCode).trim();
  if (b.transcript) {
    const rows = segmentsFromText(String(b.transcript).slice(0, 500_000));
    if (!rows.length) return NextResponse.json({ error: "That transcript is empty." }, { status: 400 });
    // Pasted text goes after anything already recorded.
    const offset = lecture.duration;
    lecture.segments.push(...rows.map((r, i) => ({ id: `s${lecture.segments.length + i + 1}`, start: offset + r.start, end: offset + r.end, text: r.text })));
    lecture.duration = Math.max(lecture.duration, lecture.segments.at(-1)!.end);
  }
  await putOne("lectures", id, lecture);
  return NextResponse.json(lecture);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await putOne("lectures", id, null);
  return NextResponse.json({ ok: true });
}
