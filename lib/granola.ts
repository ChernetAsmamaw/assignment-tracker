import { cached, listAll } from "./store";

// Granola's public API (https://docs.granola.ai). Personal API keys need a Business or Enterprise plan;
// without one, notes are pasted in by hand and stored in the "coursenotes" collection.
const BASE = "https://public-api.granola.ai/v1";
export const hasGranola = () => !!process.env.GRANOLA_API_KEY;

export interface CourseNote {
  id: string;
  source: "granola" | "import";
  courseCode: string;
  title: string;
  createdAt: string;
  url: string | null;
}

// A note pasted in from Granola (copy the summary, and optionally the share link).
export interface ImportedNote extends CourseNote {
  source: "import";
  summary: string; // markdown
}

export interface TranscriptLine {
  who: string;
  text: string;
  at: string | null;
}

export interface NoteDetail extends CourseNote {
  summary: string; // markdown
  transcript: TranscriptLine[];
  transcriptTooLarge: boolean;
}

interface GNoteSummary { id: string; title: string | null; created_at: string }
interface GFolder { id: string; name: string }
interface GPage { hasMore: boolean; cursor: string | null }
interface GTranscriptItem { speaker?: { source?: string; attribution?: string; name?: string | null }; text: string; start_time?: string | null }
interface GNote extends GNoteSummary {
  web_url: string | null;
  summary_text: string;
  summary_markdown: string | null;
  folder_membership?: GFolder[];
  transcript: GTranscriptItem[] | null;
}

class GranolaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { authorization: `Bearer ${process.env.GRANOLA_API_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const hint = res.status === 401 ? "Granola rejected the API key" : res.status === 429 ? "Granola rate limit hit, try again in a minute" : `Granola returned ${res.status}`;
    throw new GranolaError(res.status, hint);
  }
  return res.json() as Promise<T>;
}

async function getAll<T>(path: string, key: string, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page: GPage & Record<string, unknown> = await get(`${path}${sep}page_size=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...((page[key] as T[]) ?? []));
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

// "CSC263H5 F LEC0101", "csc 263" and "CSC263" all become "CSC263".
export function courseKey(code: string): string {
  const up = code.toUpperCase();
  const m = up.match(/[A-Z]{3}\s?\d{3}/);
  return (m ? m[0] : up).replace(/[^A-Z0-9]/g, "");
}

function matchCourse(text: string, keys: Map<string, string>): string | null {
  const flat = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const [key, code] of keys) if (flat.includes(key)) return code;
  return null;
}

// Notes from roughly this term: a folder named after a course claims its notes, otherwise the title has to mention the course.
async function fetchGranolaNotes(courses: string[]): Promise<CourseNote[]> {
  const keys = new Map(courses.map((c) => [courseKey(c), c]));
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  const byId = new Map<string, CourseNote>();
  const toNote = (n: GNoteSummary, courseCode: string): CourseNote => ({
    id: n.id,
    source: "granola",
    courseCode,
    title: n.title || "Untitled note",
    createdAt: n.created_at,
    url: null,
  });

  const folders = await getAll<GFolder>("/folders", "folders", 5);
  for (const f of folders) {
    const code = matchCourse(f.name, keys);
    if (!code) continue;
    const notes = await getAll<GNoteSummary>(`/notes?folder_id=${f.id}&created_after=${since}`, "notes", 5);
    for (const n of notes) byId.set(n.id, toNote(n, code));
  }
  const recent = await getAll<GNoteSummary>(`/notes?created_after=${since}`, "notes");
  for (const n of recent) {
    if (byId.has(n.id)) continue;
    const code = matchCourse(n.title ?? "", keys);
    if (code) byId.set(n.id, toNote(n, code));
  }
  return [...byId.values()];
}

// Granola notes plus pasted ones, grouped by course code, newest first. Granola failures come back as a message, not a crash.
export async function notesByCourse(courses: string[]): Promise<{ notes: Record<string, CourseNote[]>; error: string | null }> {
  const imported = Object.values(await listAll<ImportedNote>("coursenotes"));
  let fromGranola: CourseNote[] = [];
  let error: string | null = null;
  if (hasGranola() && courses.length) {
    try {
      fromGranola = await cached(`granola:list:${[...courses].sort().join(",")}`, 600, () => fetchGranolaNotes(courses));
    } catch (e) {
      error = e instanceof Error ? e.message : "Couldn't reach Granola";
    }
  }
  const notes: Record<string, CourseNote[]> = {};
  for (const n of [...fromGranola, ...imported.map(({ summary: _s, ...rest }) => rest)]) {
    (notes[n.courseCode] ??= []).push(n);
  }
  for (const list of Object.values(notes)) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { notes, error };
}

const speaker = (s: GTranscriptItem["speaker"]) =>
  s?.name || (s?.attribution === "me" || s?.source === "microphone" ? "You" : "Speaker");

export async function getGranolaNote(id: string, courseCode: string): Promise<NoteDetail> {
  return cached(`granola:note:${id}`, 3600, async () => {
    let n: GNote;
    let transcriptTooLarge = false;
    try {
      n = await get<GNote>(`/notes/${encodeURIComponent(id)}?include=transcript`);
    } catch (e) {
      if (!(e instanceof GranolaError) || e.status !== 413) throw e;
      // Long lectures can exceed the inline transcript limit; show the summary and link out for the rest.
      n = await get<GNote>(`/notes/${encodeURIComponent(id)}`);
      transcriptTooLarge = true;
    }
    return {
      id: n.id,
      source: "granola",
      courseCode,
      title: n.title || "Untitled note",
      createdAt: n.created_at,
      url: n.web_url,
      summary: n.summary_markdown ?? n.summary_text ?? "",
      transcript: (n.transcript ?? []).map((t) => ({ who: speaker(t.speaker), text: t.text, at: t.start_time ?? null })),
      transcriptTooLarge,
    };
  });
}
