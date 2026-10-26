import { gemini, hasGemini } from "./gemini";

// Class recorder: audio is transcribed in short chunks while the class runs, then the
// notes are written only from the transcript. Every note keeps the ids of the transcript
// segments it came from, so the page can show the source when you hover it.

export interface Segment {
  id: string; // "s12", stable once written
  start: number; // seconds from the start of the recording
  end: number;
  text: string;
}

export interface SourcedLine {
  text: string;
  sources: string[]; // segment ids
}

export interface LectureNotes {
  summary: SourcedLine[];
  sections: { heading: string; bullets: SourcedLine[] }[];
  actions: SourcedLine[]; // deadlines, readings, things to do that were said in class
  terms: { term: string; definition: string; sources: string[] }[];
  ai: boolean;
  dropped: number; // notes thrown away because they had no source in the transcript
  generatedAt: string;
  segmentCount: number; // transcript length the notes were written from
}

export interface Lecture {
  id: string;
  title: string;
  courseCode: string;
  createdAt: string;
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

export const newLecture = (title: string, courseCode: string): Lecture => ({
  id: `lec-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  title: title.trim() || "Lecture",
  courseCode: courseCode.trim(),
  createdAt: new Date().toISOString(),
  duration: 0,
  segments: [],
  notes: null,
});

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

// ---------- Notes ----------

const NOTE_TAKER =
  "You write class notes for a university student, like a careful note-taker who was in the room. " +
  "You may only use what the transcript says: no outside facts, no examples the lecturer didn't give, no filling gaps. " +
  "Every note must list the ids of the transcript segments that support it. If something isn't in the transcript, leave it out.";

const sourced = {
  type: "OBJECT",
  properties: { text: { type: "STRING" }, sources: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["text", "sources"],
};

export async function writeNotes(lecture: Lecture): Promise<LectureNotes> {
  const segs = lecture.segments;
  const base = { generatedAt: new Date().toISOString(), segmentCount: segs.length };
  if (hasGemini() && segs.length) {
    try {
      const transcript = segs.map((s) => `[${s.id} ${clock(s.start)}] ${s.text}`).join("\n").slice(0, 400_000);
      const mine = lecture.myNotes?.trim()
        ? `\n\nThe student's own rough notes from class. Use them to judge what mattered to them and cover those points, but every note still needs transcript sources:\n${lecture.myNotes.trim().slice(0, 6000)}`
        : "";
      const { data } = await gemini<Omit<LectureNotes, "ai" | "dropped" | "generatedAt" | "segmentCount">>({
        system: NOTE_TAKER,
        prompt:
          `Class: ${lecture.courseCode || "unknown course"}, "${lecture.title}".\n\nTranscript, one segment per line as [id time] text:\n${transcript}${mine}\n\n` +
          "Write notes from this transcript.\n" +
          "summary: 3 to 5 sentences on what the class covered and the main takeaways.\n" +
          "sections: the topics in the order they came up, each with a short heading and 2 to 8 concise bullets " +
          "(definitions, steps, examples, formulas, anything the lecturer stressed or said would be on a test).\n" +
          "actions: deadlines, readings, assignments, exam info or other things the student was told to do. Empty if none.\n" +
          "terms: key terms the lecturer defined, with the definition as they gave it. Empty if none.\n" +
          "For every item, sources is the list of segment ids (like s4) whose words support it, usually 1 to 3.",
        temperature: 0.2,
        schema: {
          type: "OBJECT",
          properties: {
            summary: { type: "ARRAY", items: sourced },
            sections: {
              type: "ARRAY",
              items: { type: "OBJECT", properties: { heading: { type: "STRING" }, bullets: { type: "ARRAY", items: sourced } }, required: ["heading", "bullets"] },
            },
            actions: { type: "ARRAY", items: sourced },
            terms: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { term: { type: "STRING" }, definition: { type: "STRING" }, sources: { type: "ARRAY", items: { type: "STRING" } } },
                required: ["term", "definition", "sources"],
              },
            },
          },
          required: ["summary", "sections", "actions", "terms"],
        },
      });
      return { ...ground(data, segs), ai: true, ...base };
    } catch (e) {
      console.error("lecture notes", e);
    }
  }
  return { ...extractive(segs), ai: false, ...base };
}

// Keeps only citations that point at real segments, and drops any note left without one.
function ground(data: Partial<Omit<LectureNotes, "ai">>, segs: Segment[]) {
  const ids = new Set(segs.map((s) => s.id));
  let dropped = 0;
  const fix = (sources: unknown) => [...new Set((Array.isArray(sources) ? sources : []).map((s) => String(s).trim().replace(/^\[|\]$/g, "")).filter((s) => ids.has(s)))];
  const lines = (list: unknown): SourcedLine[] =>
    (Array.isArray(list) ? list : []).flatMap((l: SourcedLine) => {
      const sources = fix(l?.sources);
      const text = String(l?.text ?? "").trim();
      if (!text) return [];
      if (!sources.length) return (dropped++, []);
      return [{ text, sources }];
    });
  const sections = (data.sections ?? [])
    .map((s) => ({ heading: String(s?.heading ?? "").trim() || "Notes", bullets: lines(s?.bullets) }))
    .filter((s) => s.bullets.length);
  const terms = (data.terms ?? []).flatMap((t) => {
    const sources = fix(t?.sources);
    if (!t?.term) return [];
    if (!sources.length) return (dropped++, []);
    return [{ term: String(t.term).trim(), definition: String(t.definition ?? "").trim(), sources }];
  });
  return { summary: lines(data.summary), sections, actions: lines(data.actions), terms, dropped };
}

// Without Gemini: pick the most content-heavy sentences, in order, each quoting its own segment.
const STOP = new Set(
  "the a an and or but so of to in on at for with is are was were be been this that these those it its we you they i he she um uh like just okay right yeah going gonna do does did have has had not if then there here what which who how can will would should could about as by from up out all one".split(" "),
);
const ACTION = /\b(due|deadline|assignment|homework|read(ing)?|chapter|quiz|midterm|exam|test|submit|office hours|next (week|class|lecture)|problem set|lab)\b/i;

function extractive(segs: Segment[]) {
  const words = (t: string) => t.toLowerCase().match(/[a-z][a-z'-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
  const freq = new Map<string, number>();
  for (const s of segs) for (const w of words(s.text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const score = (s: Segment) => {
    const w = words(s.text);
    return w.length < 4 ? 0 : w.reduce((n, x) => n + (freq.get(x) ?? 0), 0) / Math.sqrt(w.length);
  };
  const ranked = [...segs].sort((a, b) => score(b) - score(a));
  const line = (s: Segment): SourcedLine => ({ text: s.text, sources: [s.id] });
  const byTime = (a: Segment, b: Segment) => a.start - b.start;

  // Sections: split the class into roughly 10 minute blocks and keep the strongest lines of each.
  const sections: LectureNotes["sections"] = [];
  const block = 600;
  const last = segs.at(-1)?.end ?? 0;
  for (let t = 0; t <= last; t += block) {
    const inBlock = segs.filter((s) => s.start >= t && s.start < t + block);
    const top = [...inBlock].sort((a, b) => score(b) - score(a)).slice(0, 5).filter((s) => score(s) > 0).sort(byTime);
    if (top.length) sections.push({ heading: `${clock(t)} – ${clock(Math.min(last, t + block))}`, bullets: top.map(line) });
  }
  return {
    summary: ranked.slice(0, 4).filter((s) => score(s) > 0).sort(byTime).map(line),
    sections,
    actions: segs.filter((s) => ACTION.test(s.text)).slice(0, 8).map(line),
    terms: [],
    dropped: 0,
  };
}
