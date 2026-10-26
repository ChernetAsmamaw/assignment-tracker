import { NextResponse } from "next/server";
import { putOne } from "@/lib/store";
import type { ImportedNote } from "@/lib/granola";

// Save a Granola note pasted in by hand, for when there's no API key.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { courseCode?: string; title?: string; url?: string; summary?: string; date?: string };
  const courseCode = String(b.courseCode ?? "").trim();
  const summary = String(b.summary ?? "").trim();
  if (!courseCode || !summary) return NextResponse.json({ error: "Paste the note's summary" }, { status: 400 });
  const url = String(b.url ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: "The link should start with https://" }, { status: 400 });
  const date = b.date ? new Date(`${b.date}T12:00:00`) : new Date();
  const note: ImportedNote = {
    id: `imp_${crypto.randomUUID().slice(0, 12)}`,
    source: "import",
    courseCode,
    title: String(b.title ?? "").trim() || summary.split("\n").find((l) => l.trim())!.replace(/^[#\-*\s]+/, "").slice(0, 80),
    createdAt: (isNaN(date.getTime()) ? new Date() : date).toISOString(),
    url: url || null,
    summary: summary.slice(0, 50_000),
  };
  await putOne("coursenotes", note.id, note);
  return NextResponse.json(note);
}
