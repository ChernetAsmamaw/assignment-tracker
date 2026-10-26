import { gemini, hasGemini, plainText } from "./gemini";
import type { Lecture } from "./lectures";
import type { Assignment } from "./types";

// Study: one page per course, built around understanding concepts rather than exams.
// Concepts come from the class notes, where each keeps the transcript lines it was
// taught in, and from the assignments and projects that need them.

export type ConceptStatus = "new" | "learning" | "understood";

export const CONCEPT_STATUS: Record<ConceptStatus, string> = { new: "Not yet", learning: "Learning", understood: "Understood" };

export interface ConceptSource {
  lectureId: string;
  segments: string[]; // transcript segment ids in that class
}

export interface Concept {
  id: string;
  name: string;
  explanation: string; // from the class notes only; empty when no class covered it
  sources: ConceptSource[];
  assignments: string[]; // assignments and projects that use it
  questions: string[]; // prompts that check you can explain and apply it
  status: ConceptStatus;
  manual: boolean; // added by the student; kept when concepts are rebuilt
  updatedAt: string;
}

export interface CourseStudy {
  courseCode: string;
  concepts: Concept[];
  hidden?: string[]; // concepts you removed, by conceptKey, so a rebuild doesn't bring them back
  builtAt: string | null;
  ai: boolean;
}

export const emptyStudy = (courseCode: string): CourseStudy => ({ courseCode, concepts: [], hidden: [], builtAt: null, ai: false });

// Course codes go in URLs, and Quercus codes can contain spaces.
export const studyHref = (courseCode: string, lectureId?: string) => `/study/${encodeURIComponent(courseCode)}${lectureId ? `/${lectureId}` : ""}`;

// "CSC263: Data Structures" reads "Data Structures" under its code, so the code isn't shown twice.
export const courseTitle = (code: string, name: string) => (name.startsWith(code) ? name.slice(code.length).replace(/^[\s:–-]+/, "") : name);

export function courseFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

const newId = () => `c-${Math.random().toString(36).slice(2, 10)}`;
export const conceptKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function newConcept(name: string): Concept {
  return { id: newId(), name: name.trim().slice(0, 80), explanation: "", sources: [], assignments: [], questions: [], status: "new", manual: true, updatedAt: new Date().toISOString() };
}

// ---------- Building concepts from notes and assignments ----------

type Draft = Pick<Concept, "name" | "explanation" | "sources" | "assignments" | "questions">;

interface NoteLine {
  ref: string;
  lecture: Lecture;
  segments: string[];
  text: string;
}

function noteLines(lectures: Lecture[]): NoteLine[] {
  const out: NoteLine[] = [];
  const push = (lecture: Lecture, text: string, segments: string[]) => out.push({ ref: `n${out.length + 1}`, lecture, segments, text });
  for (const l of lectures) {
    const n = l.notes;
    if (!n) continue;
    for (const s of n.summary) push(l, s.text, s.sources);
    for (const sec of n.sections) for (const b of sec.bullets) push(l, `${sec.heading}: ${b.text}`, b.sources);
    for (const t of n.terms) push(l, `${t.term}: ${t.definition}`, t.sources);
  }
  return out;
}

export async function buildConcepts(courseCode: string, lectures: Lecture[], assignments: Assignment[], prev: CourseStudy | null): Promise<CourseStudy> {
  const open = assignments.filter((a) => !a.submitted).slice(0, 15);
  const lines = noteLines(lectures);
  let drafts: Draft[] | null = null;

  if (hasGemini() && (lines.length || open.length)) {
    try {
      const known = (prev?.concepts ?? []).map((c) => c.name);
      const { data } = await gemini<{ concepts: { name: string; explanation: string; refs: string[]; assignments: string[]; questions: string[] }[] }>({
        system:
          "You help a university student understand the ideas behind their coursework. Their courses are graded on projects and assignments, " +
          "so the goal is real understanding they can apply, not exam cramming. Explanations may only use what the class notes say.",
        prompt:
          `Course: ${courseCode}\n\n` +
          `Class notes, one per line as [ref] (class) note:\n${lines.map((l) => `[${l.ref}] (${l.lecture.title}) ${l.text}`).join("\n").slice(0, 200_000) || "(no class notes yet)"}\n\n` +
          `Open assignments and projects:\n${open.map((a) => `[${a.id}] ${a.name}${a.dueAt ? ` (due ${a.dueAt.slice(0, 10)})` : ""}: ${plainText(a.description, 700)}`).join("\n") || "(none)"}\n\n` +
          (known.length ? `Concepts the student already tracks (reuse these exact names when it's the same idea): ${known.join("; ")}\n\n` : "") +
          "List the 4 to 12 key concepts the student needs to understand for this course's work: the ideas the assignments and projects rely on, more than terms to memorise. For each:\n" +
          "name: 2 to 6 words.\n" +
          "explanation: 1 to 3 plain sentences explaining the idea using only what the class notes say. Empty string if the notes don't cover it.\n" +
          "refs: the note refs (like n4) the explanation comes from. Empty if the explanation is empty.\n" +
          "assignments: ids of the assignments or projects above that need this concept.\n" +
          "questions: 2 or 3 questions that check real understanding (why, how, when to use it, how it applies to the assignment), not recall.\n" +
          "Put the concepts the soonest-due work needs first.",
        schema: {
          type: "OBJECT",
          properties: {
            concepts: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  explanation: { type: "STRING" },
                  refs: { type: "ARRAY", items: { type: "STRING" } },
                  assignments: { type: "ARRAY", items: { type: "STRING" } },
                  questions: { type: "ARRAY", items: { type: "STRING" } },
                },
                required: ["name", "explanation", "refs", "assignments", "questions"],
              },
            },
          },
          required: ["concepts"],
        },
      });
      const byRef = new Map(lines.map((l) => [l.ref, l]));
      const ids = new Set(open.map((a) => a.id));
      drafts = (data.concepts ?? []).slice(0, 15).flatMap((c) => {
        const name = String(c.name ?? "").trim().slice(0, 80);
        if (!name) return [];
        const refs = (c.refs ?? []).map((r) => byRef.get(String(r).replace(/[[\]]/g, "").trim())).filter((r): r is NoteLine => !!r);
        return [{
          name,
          // An explanation with no note behind it isn't from class, so it isn't shown.
          explanation: refs.length ? String(c.explanation ?? "").trim() : "",
          sources: groupSources(refs),
          assignments: [...new Set((c.assignments ?? []).map(String).filter((id) => ids.has(id)))],
          questions: (c.questions ?? []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3),
        }];
      });
    } catch (e) {
      console.error("concepts", e);
    }
  }

  const ai = drafts !== null;
  const found = drafts ?? fromNotes(lectures, open);
  // Concepts you added that weren't found again: look for where they came up in class.
  const have = new Set(found.map((d) => conceptKey(d.name)));
  const yours = (prev?.concepts ?? [])
    .filter((c) => c.manual && !have.has(conceptKey(c.name)))
    .map((c) => traceConcept(c.name, lectures, open))
    .filter((d) => d.sources.length);
  const hidden = prev?.hidden ?? [];
  return { courseCode, concepts: merge(prev?.concepts ?? [], [...found, ...yours], new Set(hidden)), hidden, builtAt: new Date().toISOString(), ai };
}

// Building takes a while: keep the statuses, additions and removals made in the meantime.
export function keepEdits(built: CourseStudy, before: CourseStudy | null, latest: CourseStudy | null): CourseStudy {
  if (!latest) return built;
  const now = new Map(latest.concepts.map((c) => [c.id, c]));
  const was = new Set((before?.concepts ?? []).map((c) => c.id));
  const hidden = new Set(latest.hidden ?? []);
  const kept = built.concepts
    .filter((c) => (!was.has(c.id) || now.has(c.id)) && !hidden.has(conceptKey(c.name)))
    .map((c) => ({ ...c, status: now.get(c.id)?.status ?? c.status }));
  const ids = new Set(kept.map((c) => c.id));
  const added = latest.concepts.filter((c) => !ids.has(c.id) && !was.has(c.id));
  return { ...built, concepts: [...kept, ...added], hidden: [...hidden] };
}

function groupSources(refs: { lecture: Lecture; segments: string[] }[]): ConceptSource[] {
  const by = new Map<string, Set<string>>();
  for (const r of refs) {
    const set = by.get(r.lecture.id) ?? new Set<string>();
    r.segments.forEach((s) => set.add(s));
    by.set(r.lecture.id, set);
  }
  return [...by].map(([lectureId, segs]) => ({ lectureId, segments: [...segs] }));
}

// Keeps your status on concepts that come back, and keeps ones you added or already worked on.
function merge(prev: Concept[], drafts: Draft[], hidden: Set<string>): Concept[] {
  const old = new Map(prev.map((c) => [conceptKey(c.name), c]));
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const d of drafts) {
    const key = conceptKey(d.name);
    if (!key || seen.has(key) || hidden.has(key)) continue;
    seen.add(key);
    const was = old.get(key);
    out.push({ ...d, id: was?.id ?? newId(), status: was?.status ?? "new", manual: was?.manual ?? false, updatedAt: now });
    old.delete(key);
  }
  for (const c of old.values()) if (c.manual || c.status !== "new") out.push(c);
  return out;
}

// ---------- Without Gemini ----------

const STOP = new Set(
  "about after also and any are between but can does for from get has have how into its more not one our over such than that the their them then there these they this those through two under use using what when where which while who why with you your".split(" "),
);

// A concept's words as loose patterns: "Hash functions" also finds "hash function".
function patterns(name: string): RegExp[] {
  const words = (name.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).filter((w) => !STOP.has(w));
  return words.map((w) => new RegExp(`\\b${w.length > 4 ? w.replace(/e?s$/, "") : w}`));
}

// Text mentions a concept when it has its words: all of them for one or two, any two for longer names.
function mentions(text: string, pats: RegExp[]): boolean {
  if (!pats.length) return false;
  const t = text.toLowerCase();
  return pats.filter((p) => p.test(t)).length >= Math.min(2, pats.length);
}

function needsFor(name: string, open: Assignment[]): Assignment[] {
  const pats = patterns(name);
  return open.filter((a) => mentions(`${a.name} ${plainText(a.description, 4000)}`, pats));
}

function starterQuestions(name: string, needs: Assignment[]): string[] {
  const n = /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name; // mid-sentence, but keep acronyms
  return [
    `Explain ${n} in your own words, without looking at your notes.`,
    ...(needs[0] ? [`Where does ${n} come up in ${needs[0].name}, and how will you use it?`] : []),
  ];
}

// Where a concept came up in class: the note line that mentions it first, or else the transcript lines.
export function traceConcept(name: string, lectures: Lecture[], open: Assignment[]): Draft {
  const pats = patterns(name);
  const needs = needsFor(name, open);
  const note = noteLines(lectures).find((n) => n.segments.length && mentions(n.text, pats));
  const heard = lectures.flatMap((l) => {
    const segs = l.segments.filter((s) => mentions(s.text, pats)).slice(0, 3);
    return segs.length ? [{ lecture: l, segments: segs.map((s) => s.id), text: segs[0].text }] : [];
  });
  return {
    name: name.trim().slice(0, 80),
    explanation: note?.text ?? heard[0]?.text ?? "",
    sources: groupSources(note ? [note, ...heard] : heard),
    assignments: needs.map((a) => a.id),
    questions: starterQuestions(name, needs),
  };
}

// Key terms and topic headings from notes Gemini wrote earlier. The extractive notes have neither,
// so without Gemini the concepts are the ones you add, each traced to class by traceConcept.
function fromNotes(lectures: Lecture[], open: Assignment[]): Draft[] {
  const drafts: Draft[] = [];
  const add = (name: string, explanation: string, lectureId: string, segments: string[]) => {
    if (!name || /^\d+:\d{2}/.test(name)) return; // time-range headings aren't concepts
    const key = conceptKey(name);
    const hit = drafts.find((d) => conceptKey(d.name) === key);
    if (hit) return void hit.sources.push({ lectureId, segments });
    const needs = needsFor(name, open);
    drafts.push({ name: name.slice(0, 80), explanation, sources: [{ lectureId, segments }], assignments: needs.map((a) => a.id), questions: starterQuestions(name, needs) });
  };
  for (const l of lectures) {
    for (const t of l.notes?.terms ?? []) add(t.term, t.definition, l.id, t.sources);
    for (const s of l.notes?.sections ?? []) add(s.heading, s.bullets[0]?.text ?? "", l.id, s.bullets[0]?.sources ?? []);
  }
  return drafts.slice(0, 15);
}

// ---------- What to understand next ----------

export interface FocusItem {
  concept: Concept;
  courseCode: string;
  assignment: Assignment | null; // the soonest open work that needs it
}

// Concepts you don't understand yet, ordered by when the work that needs them is due.
export function focusList(studies: CourseStudy[], open: Assignment[]): FocusItem[] {
  const byId = new Map(open.map((a) => [a.id, a]));
  const due = (a: Assignment | null) => (a?.dueAt ? new Date(a.dueAt).getTime() : Infinity);
  const items = studies.flatMap((s) =>
    s.concepts
      .filter((c) => c.status !== "understood")
      .map((concept) => {
        const needs = concept.assignments.map((id) => byId.get(id)).filter((a): a is Assignment => !!a);
        const assignment = needs.sort((x, y) => due(x) - due(y))[0] ?? null;
        return { concept, courseCode: s.courseCode, assignment };
      }),
  );
  return items.sort((x, y) => due(x.assignment) - due(y.assignment) || (x.concept.status === "new" ? -1 : 1) - (y.concept.status === "new" ? -1 : 1));
}

// Short "understand X" blocks the Planner fits in before an assignment's own work.
export interface StudyTask {
  title: string;
  href: string;
  hours: number;
}

// Each concept is scheduled once, before the soonest open work that needs it, with at most two per assignment.
export function studyTasks(studies: CourseStudy[], open: Assignment[]): Record<string, StudyTask[]> {
  const byId = new Map(open.map((a) => [a.id, a]));
  const due = (a: Assignment) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity);
  const out: Record<string, StudyTask[]> = {};
  for (const { concept: c, courseCode } of focusList(studies, open)) {
    const needs = c.assignments.map((id) => byId.get(id)).filter((a): a is Assignment => !!a).sort((x, y) => due(x) - due(y));
    const a = needs.find((x) => (out[x.id]?.length ?? 0) < 2);
    if (a) (out[a.id] ??= []).push({ title: `Understand ${c.name}`, href: `${studyHref(courseCode)}#${c.id}`, hours: c.status === "learning" ? 0.25 : 0.5 });
  }
  return out;
}
