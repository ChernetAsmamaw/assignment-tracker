import { readFileSync } from "fs";
import path from "path";
import { gemini, hasGemini } from "./gemini";
import {
  addPart,
  clock,
  currentParts,
  openWindows,
  same,
  span,
  stitch,
  ONE_GO_SECONDS,
  type Lecture,
  type LectureNotes,
  type NotePart,
  type NotePoint,
  type NoteSection,
  type NoteWindow,
  type Question,
  type Segment,
  type SourcedLine,
  type Term,
} from "./lectures";

// Class notes, written only from the transcript. Gemini follows prompts/class-notes.md, a guide in
// plain Markdown you can edit. A long class gets notes for every 10 minutes while it records
// (writePart). When it ends, finishNotes writes the last few minutes and an overview of the whole
// class at the same time and puts everything together, so the notes are ready seconds later.

const GUIDE = path.join(process.cwd(), "prompts", "class-notes.md");
let guide = "";

// Read once in production. In development it's read every time, so an edit shows up on the next rewrite.
function notesGuide(): string {
  if (guide && process.env.NODE_ENV === "production") return guide;
  try {
    guide = readFileSync(GUIDE, "utf8");
  } catch (e) {
    console.error("class notes guide", e);
    guide = "Write clear study notes: sections named after ideas, short complete bullets, key terms in bold, formulas and dates exactly as said.";
  }
  return guide;
}

// The part the guide can't change: notes come only from the transcript, and every line cites it.
const RULES =
  "You write class notes for a university student from a transcript of the class. Use only what the transcript says: " +
  "no outside facts, no examples the lecturer didn't give, no filling gaps. Every line lists in sources the ids of the " +
  "transcript segments (like s12) whose words support it, usually 1 to 3. A line without sources is thrown away.\n\n" +
  "Follow this guide on what to write and how:\n\n";

const system = () => RULES + notesGuide();

// ---------- What Gemini sends back ----------

const STRING = { type: "STRING" };
const IDS = { type: "ARRAY", items: STRING };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "OBJECT",
  properties,
  required,
  propertyOrdering: Object.keys(properties),
});
const LINE = object({ text: STRING, sources: IDS });
const POINT = object({ text: STRING, sources: IDS, exam: { type: "BOOLEAN" }, sub: { type: "ARRAY", items: LINE } }, ["text", "sources"]);
const LINES = { type: "ARRAY", items: LINE };
const POINTS = { type: "ARRAY", items: POINT };
const SECTIONS = { type: "ARRAY", items: object({ heading: STRING, bullets: POINTS }) };
const TERMS = { type: "ARRAY", items: object({ term: STRING, definition: STRING, sources: IDS }) };
const QUESTIONS = { type: "ARRAY", items: object({ question: STRING, answer: STRING, sources: IDS }) };
const OUTLINE = { type: "ARRAY", items: object({ heading: STRING, sections: { type: "ARRAY", items: { type: "INTEGER" } } }) };

type Raw = Record<string, unknown>;
const asObject = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(asObject) : []);
const tidy = (v: unknown, max = 600) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .replace(/^(?:[-•*]|\d+[.)])\s+/, "")
    .trim()
    .slice(0, max);

// Keeps only citations that point at real segments, and drops any line left without one.
function grounder(segs: Segment[]) {
  const ids = new Set(segs.map((s) => s.id));
  let dropped = 0;
  const fix = (v: unknown) => [
    ...new Set(
      (Array.isArray(v) ? v : [v])
        .flatMap((s) => String(s ?? "").split(/[^A-Za-z0-9_]+/))
        .filter((s) => ids.has(s)),
    ),
  ];
  const line = (r: Raw): SourcedLine | null => {
    const text = tidy(r.text);
    if (!text) return null;
    const sources = fix(r.sources);
    if (!sources.length) return (dropped++, null);
    return { text, sources };
  };
  const lines = (v: unknown, max: number): SourcedLine[] => list(v).slice(0, max).flatMap((r) => line(r) ?? []);
  const points = (v: unknown, max: number): NotePoint[] =>
    list(v)
      .slice(0, max)
      .flatMap((r) => {
        const l = line(r);
        if (!l) return [];
        const sub = lines(r.sub, 8);
        return [{ ...l, ...(r.exam === true ? { exam: true } : {}), ...(sub.length ? { sub } : {}) }];
      });
  return {
    lines,
    points,
    sections: (v: unknown): NoteSection[] =>
      list(v)
        .slice(0, 16)
        .map((s) => ({ heading: tidy(s.heading, 120) || "Notes", bullets: points(s.bullets, 14) }))
        .filter((s) => s.bullets.length),
    terms: (v: unknown): Term[] =>
      list(v)
        .slice(0, 30)
        .flatMap((t) => {
          const term = tidy(t.term, 120);
          if (!term) return [];
          const sources = fix(t.sources);
          if (!sources.length) return (dropped++, []);
          return [{ term, definition: tidy(t.definition), sources }];
        }),
    questions: (v: unknown): Question[] =>
      list(v)
        .slice(0, 6)
        .flatMap((q) => {
          const question = tidy(q.question, 300);
          if (!question) return [];
          const sources = fix(q.sources);
          if (!sources.length) return (dropped++, []);
          return [{ question, answer: tidy(q.answer), sources }];
        }),
    dropped: () => dropped,
  };
}

// ---------- Prompts ----------

const transcriptOf = (segs: Segment[]) => segs.map((s) => `[${s.id} ${clock(s.start)}] ${s.text}`).join("\n");
// A title Pace picked itself is left out, so it can't steer the notes it's meant to describe.
const classOf = (l: Lecture) => `Class: ${l.courseCode || "unknown course"}${l.title.trim() && !l.titleAuto ? `, "${l.title.trim()}"` : ""}.`;
const mineOf = (l: Lecture) =>
  l.myNotes?.trim()
    ? "\n\nThe student's own notes from class. They show what mattered to the student, so make sure those points are covered, " +
      `but every line still needs transcript sources:\n${l.myNotes.trim().slice(0, 6000)}`
    : "";

function within(segs: Segment[], w: Pick<NoteWindow, "first" | "last">): Segment[] {
  const a = segs.findIndex((s) => s.id === w.first);
  const b = segs.findIndex((s) => s.id === w.last);
  return a < 0 || b < a ? [] : segs.slice(a, b + 1);
}

// ---------- Writing ----------

// Notes for one stretch of the class. `parts` are the ones written so far, so a topic that carries
// on keeps its heading and the two join up.
export async function writePart(l: Lecture, w: NoteWindow, parts: NotePart[], title = "", timeout = 50_000): Promise<{ part: NotePart; title: string }> {
  const segs = within(l.segments, w);
  const headings = stitch(parts.filter((p) => p.to <= w.from)).sections.map((s) => `"${s.heading}"`);
  const { data } = await gemini<Raw>({
    system: system(),
    prompt:
      `${classOf(l)} This is the part of the class from ${clock(w.from)} to ${clock(w.to)}.` +
      (headings.length
        ? `\nSections of the notes so far: ${headings.join(", ")}. Where this part goes on with one of those topics, use exactly the same heading, so the parts join up.`
        : "") +
      mineOf(l) +
      `\n\nTranscript of this part, one segment per line as [id time] text:\n${transcriptOf(segs)}\n\n` +
      "Write the notes for this part of the class, following the guide: sections, terms and actions, each an empty list when there's nothing for it. " +
      `Then title: a title for the whole class so far${title ? ` (until now "${title}": keep it unless this part changes what the class is mainly about)` : ""}.`,
    temperature: 0.2,
    timeout,
    schema: object({ sections: SECTIONS, terms: TERMS, actions: LINES, title: STRING }),
  });
  const d = asObject(data);
  const g = grounder(segs);
  const part: NotePart = {
    first: w.first,
    last: w.last,
    sig: w.sig,
    from: w.from,
    to: w.to,
    sections: g.sections(d.sections),
    terms: g.terms(d.terms),
    actions: g.lines(d.actions, 12),
    dropped: 0,
    writtenAt: new Date().toISOString(),
  };
  part.dropped = g.dropped();
  return { part, title: cleanTitle(d.title) };
}

export interface Finished {
  notes: LectureNotes;
  title: string; // picked from the content; empty when there's nothing to go on
  parts: NotePart[] | null; // the parts to save, when they changed
}

// The finished notes for a whole class: in one go for a short transcript, otherwise from its parts.
export async function finishNotes(l: Lecture, saved: NotePart[], opts: { fresh?: boolean; title?: string } = {}): Promise<Finished> {
  const started = Date.now();
  const left = () => 54_000 - (Date.now() - started); // the route gets 60 seconds
  const segs = l.segments;
  const base = { generatedAt: new Date().toISOString(), segmentCount: segs.length };
  const parts = opts.fresh ? [] : currentParts(saved, segs);
  const cleared = opts.fresh && saved.length ? [] : null;

  if (hasGemini() && segs.length) {
    if (parts.length || span(segs) > ONE_GO_SECONDS) {
      const done = await fromParts(l, parts, left, opts.title ?? "");
      return { ...done, notes: { ...done.notes, ...base } };
    }
    try {
      const done = await oneGo(l, left() - 2_000);
      return { notes: { ...done.notes, ...base }, title: done.title || guessTitle(l), parts: cleared };
    } catch (e) {
      console.error("class notes", e);
    }
  }
  return { notes: { ...extractive(segs), ai: false, ...base }, title: guessTitle(l), parts: cleared };
}

async function oneGo(l: Lecture, timeout: number) {
  const segs = l.segments;
  const { data } = await gemini<Raw>({
    system: system(),
    prompt:
      `${classOf(l)}${mineOf(l)}\n\nTranscript, one segment per line as [id time] text:\n${transcriptOf(segs).slice(0, 400_000)}\n\n` +
      "Write the notes for this class, following the guide: sections, terms and actions first, then summary, takeaways, questions and title.",
    temperature: 0.2,
    timeout,
    schema: object({ sections: SECTIONS, terms: TERMS, actions: LINES, summary: LINES, takeaways: POINTS, questions: QUESTIONS, title: STRING }),
  });
  const d = asObject(data);
  const g = grounder(segs);
  const { sections, terms, actions } = stitch([{ sections: g.sections(d.sections), terms: g.terms(d.terms), actions: g.lines(d.actions, 15) }]);
  const notes = {
    summary: g.lines(d.summary, 4),
    takeaways: g.points(d.takeaways, 7),
    sections: sections.map(unique),
    actions,
    terms,
    questions: g.questions(d.questions),
    ai: true,
    dropped: g.dropped(),
  };
  return { notes, title: cleanTitle(d.title) };
}

interface Overview {
  outline: { heading: string; sections: number[] }[];
  summary: SourcedLine[];
  takeaways: NotePoint[];
  actions: SourcedLine[];
  questions: Question[];
  title: string;
  dropped: number;
}

// The whole class from its parts: which sections belong together, the summary, takeaways, to-dos,
// questions and title. `rest` is transcript that has no part yet, usually the last few minutes.
async function writeOverview(l: Lecture, parts: NotePart[], rest: Segment[], timeout: number): Promise<Overview> {
  const { sections, terms, actions } = stitch(parts);
  const ids = (s: string[]) => `{${s.join(" ")}}`;
  const outline = sections
    .map((s, i) =>
      [`[${i + 1}] ${s.heading}`, ...s.bullets.flatMap((b) => [`- ${ids(b.sources)} ${b.text}`, ...(b.sub ?? []).map((c) => `  - ${ids(c.sources)} ${c.text}`)])].join("\n"),
    )
    .join("\n\n");
  const more = [
    terms.length ? `Key terms:\n${terms.map((t) => `- ${ids(t.sources)} ${t.term}: ${t.definition}`).join("\n")}` : "",
    actions.length ? `To do:\n${actions.map((a) => `- ${ids(a.sources)} ${a.text}`).join("\n")}` : "",
    rest.length ? `The end of the class isn't in these notes yet. Its transcript, one segment per line as [id time] text:\n${transcriptOf(rest)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data } = await gemini<Raw>({
    system: system(),
    prompt:
      `${classOf(l)}${mineOf(l)}\n\nThese are the notes so far, written part by part as the class went. Sections are numbered, and each line starts with its sources in braces.\n\n` +
      `${outline || "(no sections yet)"}${more ? `\n\n${more}` : ""}\n\n` +
      "Finish the notes for the whole class, following the guide:\n" +
      "- outline: the final sections, organized by idea. Each has a heading that names its idea and the numbers of the sections above that go under it. " +
      "Join sections about the same idea, such as a topic split across parts, and keep different ideas apart. Use every section number once.\n" +
      `- summary, takeaways and questions for the whole class${rest.length ? ", its end included" : ""}. Their sources are ids copied from the lines above${rest.length ? " or from the transcript" : ""}.\n` +
      "- actions: everything the student was told to do, each once, with exact dates and times.\n" +
      "- title.",
    temperature: 0.2,
    timeout,
    schema: object({ outline: OUTLINE, summary: LINES, takeaways: POINTS, actions: LINES, questions: QUESTIONS, title: STRING }),
  });
  const d = asObject(data);
  const g = grounder(l.segments);
  return {
    outline: list(d.outline).map((o) => ({
      heading: tidy(o.heading, 120),
      sections: (Array.isArray(o.sections) ? o.sections : []).map(Number).filter(Number.isInteger),
    })),
    summary: g.lines(d.summary, 4),
    takeaways: g.points(d.takeaways, 7),
    actions: g.lines(d.actions, 15),
    questions: g.questions(d.questions),
    title: cleanTitle(d.title),
    dropped: g.dropped(),
  };
}

async function fromParts(l: Lecture, saved: NotePart[], left: () => number, title: string): Promise<Omit<Finished, "notes"> & { notes: Omit<LectureNotes, "generatedAt" | "segmentCount"> }> {
  const segs = l.segments;
  let parts = saved;
  let wrote = false;
  // Stretches with no notes yet. The last is written alongside the overview; any others first,
  // while there's time. What's still left is picked from the transcript instead.
  const open = openWindows(segs, parts);
  const last = open.pop();
  for (const w of open) {
    if (left() < 35_000) break;
    try {
      parts = addPart(parts, (await writePart(l, w, parts, title, Math.min(25_000, left() - 30_000))).part, segs);
      wrote = true;
    } catch (e) {
      console.error("notes part", e);
      break;
    }
  }
  const score = scorer(segs);
  const picked = openWindows(segs, parts)
    .filter((w) => w.first !== last?.first)
    .map((w) => pickedPart(within(segs, w), w, score));
  const before = [...parts, ...picked].sort((a, b) => a.from - b.from);
  const [end, overview] = await Promise.all([
    last ? writePart(l, last, parts, title, left() - 2_000).catch((e) => (console.error("notes part", e), null)) : null,
    writeOverview(l, before, last ? within(segs, last) : [], left() - 2_000).catch((e) => (console.error("notes overview", e), null)),
  ]);
  if (end) {
    parts = addPart(parts, end.part, segs);
    wrote = true;
  }
  const tail = end?.part ?? (last ? pickedPart(within(segs, last), last, score) : null);

  // The overview's outline joins and renames the sections. The last part's sections then join
  // the section they carry on, by heading, or come at the end.
  const stitched = stitch(before);
  const { sections, of } = regroup(stitched.sections, overview?.outline ?? []);
  const named = new Map<string, NoteSection>();
  stitched.sections.forEach((s, i) => named.set(same(s.heading), of[i]));
  for (const s of sections) named.set(same(s.heading), s);
  for (const s of tail?.sections ?? []) {
    const have = named.get(same(s.heading));
    if (have) have.bullets.push(...s.bullets);
    else {
      const section = { heading: s.heading, bullets: [...s.bullets] };
      named.set(same(s.heading), section);
      sections.push(section);
    }
  }
  const all = stitch(tail ? [...before, tail] : before);
  const notes = {
    summary: overview?.summary ?? [],
    takeaways: overview?.takeaways ?? [],
    sections: sections.map(unique),
    // The overview lists each to-do once, though the class may have said it twice.
    actions: overview && (overview.actions.length || !all.actions.length) ? overview.actions : all.actions,
    terms: all.terms,
    questions: overview?.questions ?? [],
    ai: parts.length > 0 || !!overview,
    dropped: parts.reduce((n, p) => n + p.dropped, 0) + (overview?.dropped ?? 0),
  };
  return { notes, title: overview?.title || end?.title || title || guessTitle(l), parts: wrote ? parts : null };
}

// Joins and renames sections as the outline says. A section the outline leaves out keeps its own
// heading, and every group sits where its first section was. `of[i]` is where section i ended up.
function regroup(sections: NoteSection[], outline: Overview["outline"]): { sections: NoteSection[]; of: NoteSection[] } {
  const group = new Map<number, number>();
  outline.forEach((g, gi) => g.sections.forEach((n) => sections[n - 1] && !group.has(n - 1) && group.set(n - 1, gi)));
  const out: NoteSection[] = [];
  const made = new Map<number, NoteSection>();
  const of = sections.map((s, i) => {
    const gi = group.get(i);
    if (gi == null) {
      const own = { heading: s.heading, bullets: [...s.bullets] };
      out.push(own);
      return own;
    }
    let g = made.get(gi);
    if (!g) {
      g = { heading: outline[gi].heading || s.heading, bullets: [] };
      made.set(gi, g);
      out.push(g);
    }
    g.bullets.push(...s.bullets);
    return g;
  });
  return { sections: out, of };
}

// A section without the same line twice.
function unique(s: NoteSection): NoteSection {
  const seen = new Set<string>();
  return { ...s, bullets: s.bullets.filter((b) => !seen.has(same(b.text)) && !!seen.add(same(b.text))) };
}

// ---------- Without Gemini ----------

const STOP = new Set(
  "the a an and or but so of to in on at for with is are was were be been this that these those it its we you they i he she um uh like just okay right yeah going gonna do does did have has had not if then there here what which who how can will would should could about as by from up out all one".split(" "),
);
// Words a class says a lot that never name its topic.
const FILLER = new Set(
  "also actually basically really very much more most some any each every other another into over than them their our your his her him me my us get got let lets let's say said see look looks know want need thing things something stuff lot lots kind sort mean means way ways time times today class lecture question questions example examples okay alright guys everyone people think make makes made take takes use used using go goes now well when where why because first second next last two three only same still even back again maybe sure yes no".split(
    " ",
  ),
);
const ACTION = /\b(due|deadline|assignment|homework|read(ing)?|chapter|quiz|midterm|exam|test|submit|office hours|next (week|class|lecture)|problem set|lab)\b/i;

const words = (t: string) => t.toLowerCase().match(/[a-z][a-z'-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
const byTime = (a: Segment, b: Segment) => a.start - b.start;
const quote = (s: Segment): SourcedLine => ({ text: s.text, sources: [s.id] });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// How much a sentence says: its words, weighted by how often the class uses them.
function scorer(segs: Segment[]) {
  const freq = new Map<string, number>();
  for (const s of segs) for (const w of words(s.text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return (s: Segment) => {
    const w = words(s.text);
    return w.length < 4 ? 0 : w.reduce((n, x) => n + (freq.get(x) ?? 0), 0) / Math.sqrt(w.length);
  };
}

// The phrases a text uses most: repeated two-word terms first ("hash table"), then single words
// unless `pairsOnly`.
export function keyPhrases(text: string, n: number, pairsOnly = false): string[] {
  const all = text.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]*/gu) ?? [];
  const ok = (w?: string): w is string => !!w && w.length > 2 && !STOP.has(w) && !FILLER.has(w);
  const one = new Map<string, number>();
  const two = new Map<string, number>();
  all.forEach((w, i) => {
    if (!ok(w)) return;
    one.set(w, (one.get(w) ?? 0) + 1);
    const next = all[i + 1];
    if (ok(next)) two.set(`${w} ${next}`, (two.get(`${w} ${next}`) ?? 0) + 1);
  });
  const ranked = [...[...two].filter(([, c]) => c > 1).map(([p, c]) => [p, c * 2] as const), ...(pairsOnly ? [] : [...one].filter(([, c]) => c > 1))].sort(
    (a, b) => b[1] - a[1],
  );
  const out: string[] = [];
  for (const [p] of ranked) {
    if (out.some((o) => o.split(" ").some((w) => p.split(" ").includes(w)))) continue;
    out.push(p);
    if (out.length === n) break;
  }
  return out;
}

// A stretch of class picked through: its strongest lines, under the words it uses most.
function pickedSection(segs: Segment[], score: (s: Segment) => number, from: number, to: number): NoteSection | null {
  const top = [...segs].sort((a, b) => score(b) - score(a)).slice(0, 5).filter((s) => score(s) > 0).sort(byTime);
  if (!top.length) return null;
  const about = keyPhrases(segs.map((s) => s.text).join(" "), 3);
  return { heading: `${about.length ? capital(about.join(", ")) : "Notes"} (${clock(from)}–${clock(to)})`, bullets: top.map(quote) };
}

function pickedPart(segs: Segment[], w: NoteWindow, score: (s: Segment) => number): NotePart {
  const section = pickedSection(segs, score, w.from, w.to);
  return {
    first: w.first,
    last: w.last,
    sig: w.sig,
    from: w.from,
    to: w.to,
    sections: section ? [section] : [],
    terms: [],
    actions: segs.filter((s) => ACTION.test(s.text)).slice(0, 4).map(quote),
    dropped: 0,
    writtenAt: new Date().toISOString(),
  };
}

// Without Gemini: the most content-heavy sentences, in order, each quoting its own segment.
function extractive(segs: Segment[]): Omit<LectureNotes, "ai" | "generatedAt" | "segmentCount"> {
  const score = scorer(segs);
  // Sections: roughly 10 minute blocks, each with its strongest lines.
  const sections: NoteSection[] = [];
  const block = 600;
  const last = segs.at(-1)?.end ?? 0;
  for (let t = 0; t <= last; t += block) {
    const section = pickedSection(
      segs.filter((s) => s.start >= t && s.start < t + block),
      score,
      t,
      Math.min(last, t + block),
    );
    if (section) sections.push(section);
  }
  return {
    summary: [...segs].sort((a, b) => score(b) - score(a)).slice(0, 4).filter((s) => score(s) > 0).sort(byTime).map(quote),
    sections,
    actions: segs.filter((s) => ACTION.test(s.text)).slice(0, 8).map(quote),
    terms: [],
    dropped: 0,
  };
}

// ---------- Titles ----------

const cleanTitle = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .replace(/^\s*["'“‘]+|["'”’.]+\s*$/g, "")
    .replace(/^[A-Z]{2,4}\s?\d{3}[A-Z0-9]*\s*[:\-–—]\s*/, "")
    .trim()
    .slice(0, 80);

// A title without Gemini: a short first line of your notes, or the terms the class used most.
export function guessTitle(l: Pick<Lecture, "myNotes" | "segments" | "notes">): string {
  const first = l.myNotes
    ?.split("\n")
    .map((x) => x.replace(/^\s*(?:#+|[-*•]|\d+[.)])\s*/, "").trim())
    .find(Boolean);
  const length = first?.split(/\s+/).length ?? 0;
  if (first && length <= 6 && !/[.?!,;:]$/.test(first)) return cleanTitle(first);
  const text = [l.myNotes ?? "", ...(l.notes?.sections.map((s) => s.heading) ?? []), ...l.segments.map((s) => s.text)].join("\n");
  const top = keyPhrases(text, 2, true);
  if (top.length) return cleanTitle(capital(top.join(" and ")));
  return first && length <= 10 ? cleanTitle(first) : "";
}

// A title for a note from what's on it: your notes, its class notes, or the start of its transcript.
export async function nameNote(l: Lecture): Promise<string> {
  const n = l.notes;
  const content = [
    l.myNotes?.trim() ? `The student's notes:\n${l.myNotes.trim().slice(0, 4000)}` : "",
    n ? `Notes from the class recording:\n${[...n.summary.map((x) => x.text), ...n.sections.map((s) => `- ${s.heading}`)].join("\n").slice(0, 3000)}` : "",
    !n && l.segments.length ? `The start of the class transcript:\n${l.segments.map((s) => s.text).join(" ").slice(0, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!content) return "";
  if (hasGemini()) {
    try {
      const { data } = await gemini<Raw>({
        system: "You name pages of a university student's study notes.",
        prompt:
          `Course: ${l.courseCode || "unknown"}\n\n${content}\n\n` +
          'Write a title for this page: what it\'s about in 2 to 6 words, like a textbook section ("Hash tables and collision handling"). ' +
          'If the notes start with a heading that names the topic, use it. No course code, date, "Lecture", "Notes" or quotes.',
        fast: true,
        temperature: 0.2,
        timeout: 15_000,
        schema: object({ title: STRING }),
      });
      const title = cleanTitle(asObject(data).title);
      if (title) return title;
    } catch (e) {
      console.error("note title", e);
    }
  }
  return guessTitle(l);
}
