import { NextResponse } from "next/server";
import { isDay } from "@/lib/format";
import { segmentsFromText, type Lecture, type LectureMine } from "@/lib/lectures";
import { getOne, putOne, saveError } from "@/lib/store";

// Rename, re-date, move to another course, add a pasted transcript, or save your own notes and ticked to-dos.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { title?: string; date?: string; courseCode?: string; transcript?: string; myNotes?: string; checked?: string[] };
  try {
    if (b.myNotes != null || b.checked != null) {
      const mine = (await getOne<LectureMine>("lecturemine", id)) ?? { myNotes: "", checked: [] };
      if (b.myNotes != null) mine.myNotes = String(b.myNotes).slice(0, 50_000);
      if (Array.isArray(b.checked)) mine.checked = b.checked.map(String).slice(0, 100);
      await putOne("lecturemine", id, mine);
      if (b.title == null && b.date == null && b.courseCode == null && !b.transcript) return NextResponse.json(mine);
    }

    const lecture = await getOne<Lecture>("lectures", id);
    if (!lecture) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (b.title != null) lecture.title = String(b.title).trim().slice(0, 200);
    if (isDay(b.date)) lecture.date = b.date;
    if (b.courseCode != null) lecture.courseCode = String(b.courseCode).trim() || lecture.courseCode;
    if (b.transcript) {
      const rows = segmentsFromText(String(b.transcript).slice(0, 500_000));
      if (!rows.length) return NextResponse.json({ error: "That transcript is empty." }, { status: 400 });
      // Pasted text goes after anything already recorded.
      const offset = lecture.duration;
      let n = Math.max(0, ...lecture.segments.map((s) => Number(s.id.slice(1)) || 0));
      lecture.segments.push(...rows.map((r) => ({ id: `s${++n}`, start: offset + r.start, end: offset + r.end, text: r.text })));
      lecture.duration = Math.max(lecture.duration, lecture.segments.at(-1)!.end);
    }
    await putOne("lectures", id, lecture);
    return NextResponse.json(lecture);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await Promise.all([putOne("lectures", id, null), putOne("lecturemine", id, null)]);
  } catch (e) {
    return NextResponse.json({ error: saveError(e) }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
