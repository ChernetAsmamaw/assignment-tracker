import { dayOf } from "./format";
import { gemini, hasGemini } from "./gemini";

// A note in a course: what you type, plus an optional class recording. A recording is
// transcribed in short chunks while the class runs, and notes are written only from the
// transcript (lib/class-notes.ts): part by part during a long class, then finished at the end.
// Every written note keeps the ids of the transcript segments it came from, so the page can
// show the source when you hover it.

export interface Segment {
  id: string; // "s12", stable once written
  start: number; // seconds from the start of the recording
  end: number;
  text: string;
}

export interface SourcedLine {
  text: string; // may use **bold** and `code`
  sources: string[]; // segment ids
}

// A line of the notes that can have points under it, and be flagged as test material.
export interface NotePoint extends SourcedLine {
  exam?: boolean; // the lecturer said it's on a test, or stressed it
  sub?: SourcedLine[];
}

export interface NoteSection {
  heading: string;
  bullets: NotePoint[];
}

export interface Term {
  term: string;
  definition: string;
  sources: string[];
}

export interface Question {
  question: string;
  answer: string;
  sources: string[];
}

export interface LectureNotes {
  summary: SourcedLine[]; // "In short"
  takeaways?: NotePoint[]; // the few ideas worth memorizing (notes written before these existed have none)
  sections: NoteSection[];
  actions: SourcedLine[]; // deadlines, readings, things to do that were said in class
  terms: Term[];
  questions?: Question[]; // to test yourself with
  ai: boolean;
  dropped: number; // notes thrown away because they had no source in the transcript
  generatedAt: string;
  segmentCount: number; // transcript length the notes were written from
}

// Notes for one stretch of a long class (up to 10 minutes), written while it's still being
// recorded. When the class ends, the finished notes are put together from the parts, so they
// take seconds instead of a pass over the whole transcript.
export interface NotePart {
  first: string; // the transcript segments it covers: the ids of the first and last,
  last: string;
  sig: string; // and a fingerprint of every id in between
  from: number; // seconds
  to: number;
  sections: NoteSection[];
  terms: Term[];
  actions: SourcedLine[];
  dropped: number;
  writtenAt: string;
}

// A note's parts are saved apart from it, so writing one never overwrites transcript lines
// being saved at the same moment.
export interface LectureParts {
  parts: NotePart[];
  title?: string; // a title for the class so far, from the latest part
}

export interface Lecture {
  id: string;
  title: string; // empty until you name it, or Pace names it from what's on the page
  titleAuto?: boolean; // the title was picked from the content, so a better pick can replace it
  courseCode: string;
  createdAt: string;
  date?: string; // YYYY-MM-DD the note is for; sets its place in the course's list. Older notes use createdAt.
  duration: number; // seconds recorded so far
  segments: Segment[];
  notes: LectureNotes | null;
  // What you type is stored apart from the lecture (see LectureMine) and merged in when a page loads.
  myNotes?: string;
  checked?: string[];
}

// Your own notes and ticked to-dos live in their own record, so typing during class never
// overwrites transcript lines that are being saved at the same moment.
export interface LectureMine {
  myNotes: string; // steers what the written notes focus on
  checked: string[]; // to-dos from the notes you've ticked off, by text
}

export const newLecture = (title: string, courseCode: string, date = dayOf()): Lecture => ({
  id: `lec-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  title: title.trim(),
  courseCode: courseCode.trim(),
  createdAt: new Date().toISOString(),
  date,
  duration: 0,
  segments: [],
  notes: null,
});

export const noteDay = (l: Pick<Lecture, "date" | "createdAt">) => l.date ?? dayOf(l.createdAt);

// Oldest first; notes on the same day stay in the order they were made.
export const byDay = (a: Pick<Lecture, "date" | "createdAt">, b: Pick<Lecture, "date" | "createdAt">) =>
  noteDay(a).localeCompare(noteDay(b)) || a.createdAt.localeCompare(b.createdAt);

export const noteTitle = (l: Pick<Lecture, "title">) => l.title.trim() || "Untitled";

// The first line of what you wrote, or of the written notes, for lists.
export function notePreview(l: Lecture, mine?: string): string {
  const first = (mine ?? l.myNotes ?? "").split("\n").map((x) => x.trim()).find(Boolean);
  if (first) return first.slice(0, 160);
  const line = l.notes?.summary[0] ?? l.notes?.takeaways?.[0] ?? l.notes?.sections[0]?.bullets[0];
  if (line) return plain(line.text);
  return l.segments.length ? `Recorded ${clock(l.duration)}, notes not written yet` : "";
}

// A note line without its Markdown marks.
export const plain = (text: string) => text.replace(/\*\*|`/g, "");

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

// ---------- Transcription ----------

const TRANSCRIBE =
  "You transcribe university lecture recordings word for word. Write only what is actually said. " +
  "Never add, summarise or guess at words you can't hear; skip silence and unintelligible parts.";

// Turns one recorded chunk into transcript segments. `offset` is where the chunk starts in the
// lecture. `fallback` is what the browser's live captions heard in the same window; it is used
// when Gemini isn't available, so the recorder still works without a key.
export async function transcribeChunk(
  audio: { mimeType: string; data: string } | null,
  offset: number,
  length: number,
  fallback: string,
): Promise<{ segments: Omit<Segment, "id">[]; ai: boolean }> {
  if (audio && hasGemini()) {
    try {
      const { data } = await gemini<{ start: number; text: string }[]>({
        system: TRANSCRIBE,
        prompt:
          `This audio is about ${Math.round(length)} seconds of a class. Transcribe it as a list of segments, ` +
          "one or two sentences each, in order. start is the second within this clip where the segment begins. " +
          "If nobody speaks, return an empty list.",
        audio,
        temperature: 0,
        schema: {
          type: "ARRAY",
          items: { type: "OBJECT", properties: { start: { type: "NUMBER" }, text: { type: "STRING" } }, required: ["start", "text"] },
        },
      });
      const rows = (Array.isArray(data) ? data : [])
        .map((r) => ({ start: Math.min(length, Math.max(0, Number(r.start) || 0)), text: String(r.text ?? "").replace(/\s+/g, " ").trim() }))
        .filter((r) => r.text)
        .sort((a, b) => a.start - b.start);
      return { segments: timed(rows, offset, length), ai: true };
    } catch (e) {
      console.error("transcribe", e);
    }
  }
  // Live captions: split into sentences and spread them across the chunk.
  const sentences = splitSentences(fallback);
  const step = length / Math.max(1, sentences.length);
  return { segments: timed(sentences.map((text, i) => ({ start: i * step, text })), offset, length), ai: false };
}

function timed(rows: { start: number; text: string }[], offset: number, length: number): Omit<Segment, "id">[] {
  return rows.map((r, i) => ({
    start: round(offset + r.start),
    end: round(offset + (rows[i + 1]?.start ?? length)),
    text: r.text.slice(0, 1200),
  }));
}

const round = (n: number) => Math.round(n * 10) / 10;

function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  // Live captions often have no punctuation at all; cut long runs into ~30 word pieces.
  return parts.flatMap((p) => {
    const words = p.trim().split(" ");
    const out: string[] = [];
    for (let i = 0; i < words.length; i += 30) out.push(words.slice(i, i + 30).join(" "));
    return out;
  }).filter(Boolean);
}

// Pasted text (e.g. an exported transcript): one segment per line or sentence, with times if it has them.
export function segmentsFromText(text: string): Omit<Segment, "id">[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const rows: { start: number | null; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*[-–:]?\s*(.*)$/);
    if (m) {
      const [h, mm, ss] = m[3] != null ? [+m[1], +m[2], +m[3]] : [0, +m[1], +m[2]];
      rows.push({ start: h * 3600 + mm * 60 + ss, text: m[4] });
    } else for (const s of splitSentences(line)) rows.push({ start: null, text: s });
  }
  // Untimed text: assume a speaking pace of about 150 words a minute.
  let t = 0;
  const filled = rows.filter((r) => r.text).map((r) => {
    const start = r.start ?? t;
    t = start + Math.max(2, r.text.split(" ").length * 0.4);
    return { start, text: r.text };
  });
  return filled.map((r, i) => ({ start: r.start, end: filled[i + 1]?.start ?? round(t), text: r.text.slice(0, 1200) }));
}

// ---------- Notes, part by part ----------

export const PART_SECONDS = 600; // a long class gets notes for every 10 minutes while it records
export const ONE_GO_SECONDS = 25 * 60; // a transcript up to this long is written up in one go

export interface NoteWindow {
  first: string;
  last: string;
  sig: string;
  from: number;
  to: number;
  ready: boolean; // the class has moved past it, so its notes won't stop mid-thought
}

// How long a transcript runs, from its first line to its last.
export const span = (segs: Segment[]) => (segs.length ? segs[segs.length - 1].end - segs[0].start : 0);

// A short fingerprint of which transcript segments a part was written from.
function fingerprint(segs: Segment[]): string {
  const ids = segs.map((s) => s.id).join(" ");
  let h = 0x811c9dc5;
  for (let i = 0; i < ids.length; i++) h = Math.imul(h ^ ids.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// The parts that still match the transcript, in order. A minute of audio that's sent again
// gets new segment ids, so the part written from the old ones no longer counts.
export function currentParts(parts: NotePart[], segs: Segment[]): NotePart[] {
  const at = new Map(segs.map((s, i) => [s.id, i]));
  const out: NotePart[] = [];
  let end = -1;
  for (const p of [...parts].sort((a, b) => (at.get(a.first) ?? -1) - (at.get(b.first) ?? -1))) {
    const a = at.get(p.first);
    const b = at.get(p.last);
    if (a == null || b == null || a <= end || b < a || fingerprint(segs.slice(a, b + 1)) !== p.sig) continue;
    out.push(p);
    end = b;
  }
  return out;
}

// The stretches of transcript that have no notes yet, in order, each up to 10 minutes long.
export function openWindows(segs: Segment[], parts: NotePart[]): NoteWindow[] {
  const at = new Map(segs.map((s, i) => [s.id, i]));
  const covered = new Array<boolean>(segs.length).fill(false);
  for (const p of currentParts(parts, segs)) covered.fill(true, at.get(p.first)!, at.get(p.last)! + 1);
  const out: NoteWindow[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (covered[i]) continue;
    let j = i;
    while (j + 1 < segs.length && !covered[j + 1] && segs[j + 1].start < segs[i].start + PART_SECONDS) j++;
    out.push({ first: segs[i].id, last: segs[j].id, sig: fingerprint(segs.slice(i, j + 1)), from: segs[i].start, to: segs[j].end, ready: j + 1 < segs.length });
    i = j;
  }
  return out;
}

// The next stretch that's ready for notes, if any.
export const nextWindow = (segs: Segment[], parts: NotePart[]) => openWindows(segs, parts).find((w) => w.ready) ?? null;

// Adds a newly written part in place of any part it overlaps.
export function addPart(parts: NotePart[], part: NotePart, segs: Segment[]): NotePart[] {
  const at = new Map(segs.map((s, i) => [s.id, i]));
  const a = at.get(part.first) ?? -1;
  const b = at.get(part.last) ?? -1;
  const kept = currentParts(parts, segs).filter((p) => at.get(p.last)! < a || at.get(p.first)! > b);
  return currentParts([...kept, part], segs);
}

// Two names for the same thing, give or take case, accents and punctuation.
export const same = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// The parts as one set of notes: sections with the same heading join up, wherever in the
// class they came, and a term or to-do said twice is kept once.
export function stitch(parts: Pick<NotePart, "sections" | "terms" | "actions">[]): Pick<LectureNotes, "sections" | "terms" | "actions"> {
  const sections: NoteSection[] = [];
  const named = new Map<string, NoteSection>();
  for (const s of parts.flatMap((p) => p.sections)) {
    const have = named.get(same(s.heading));
    if (have) have.bullets.push(...s.bullets);
    else {
      const section = { heading: s.heading, bullets: [...s.bullets] };
      named.set(same(s.heading), section);
      sections.push(section);
    }
  }
  const terms = new Map<string, Term>();
  for (const t of parts.flatMap((p) => p.terms)) {
    const have = terms.get(same(t.term));
    if (have) have.sources = [...new Set([...have.sources, ...t.sources])];
    else terms.set(same(t.term), { ...t });
  }
  const actions = new Map<string, SourcedLine>();
  for (const a of parts.flatMap((p) => p.actions)) if (!actions.has(same(a.text))) actions.set(same(a.text), a);
  return { sections, terms: [...terms.values()], actions: [...actions.values()] };
}

// What the parts written so far add up to, shown while the class is still going.
export function draftNotes(parts: NotePart[]): LectureNotes {
  return {
    summary: [],
    ...stitch(parts),
    ai: true,
    dropped: parts.reduce((n, p) => n + p.dropped, 0),
    generatedAt: parts.at(-1)?.writtenAt ?? "",
    segmentCount: 0,
  };
}
