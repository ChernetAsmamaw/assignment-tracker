import Link from "next/link";
import { loadAll } from "@/lib/data";
import { getOne } from "@/lib/store";
import { courseColor } from "@/lib/colors";
import { formatDue } from "@/lib/format";
import { getGranolaNote, hasGranola, notesByCourse, type ImportedNote, type NoteDetail } from "@/lib/granola";
import { markdownToHtml } from "@/lib/markdown";
import NoteTools from "./NoteTools";

export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Toronto" });

async function openNote(id: string, code: string): Promise<{ note: NoteDetail | null; error: string | null }> {
  if (id.startsWith("imp_")) {
    const n = await getOne<ImportedNote>("coursenotes", id);
    return { note: n && n.courseCode === code ? { ...n, transcript: [], transcriptTooLarge: false } : null, error: null };
  }
  if (!hasGranola() || !/^not_[a-z0-9]{14}$/i.test(id)) return { note: null, error: null };
  try {
    return { note: await getGranolaNote(id, code), error: null };
  } catch (e) {
    return { note: null, error: e instanceof Error ? e.message : "Couldn't load this note from Granola" };
  }
}

export default async function CoursePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ note?: string }> }) {
  const code = decodeURIComponent((await params).code);
  const q = await searchParams;
  const { assignments, studyPlans } = await loadAll();
  const name = assignments.find((a) => a.courseCode === code)?.course.replace(/^[^:]*:\s*/, "") ?? code;
  const { notes: all, error } = await notesByCourse([...new Set(assignments.map((a) => a.courseCode))]);
  const notes = all[code] ?? [];
  const selectedId = q.note ?? notes[0]?.id;
  const { note, error: noteError } = selectedId ? await openNote(selectedId, code) : { note: null, error: null };
  const plans = studyPlans.filter((p) => p.courseCode === code);
  const open = assignments.filter((a) => a.courseCode === code && !a.submitted && a.dueAt && new Date(a.dueAt).getTime() > Date.now());
  const href = (id: string) => `/study/course/${encodeURIComponent(code)}?note=${encodeURIComponent(id)}`;

  return (
    <>
      <p className="small"><Link href="/study">← Study plans</Link></p>
      <header className="page-head course-head" style={{ "--c": courseColor(code) } as React.CSSProperties}>
        <div>
          <span className="eyebrow" style={{ color: "var(--c)" }}>{code}</span>
          <h1>{name}</h1>
          <p>
            {notes.length} lecture note{notes.length === 1 ? "" : "s"} · {open.length} open assignment{open.length === 1 ? "" : "s"}
            {plans.length > 0 && <> · {plans.map((p) => <Link key={p.id} href={`/study/${p.id}`} style={{ marginLeft: 6 }}>{p.title} ({formatDue(p.examAt)})</Link>)}</>}
          </p>
        </div>
        <Link href={`/study?course=${encodeURIComponent(code)}`} className="btn">Plan an exam</Link>
      </header>

      {error && <p className="banner">Granola: {error}. Showing pasted notes only.</p>}

      <div className="notes-layout">
        <aside className="notes-list">
          <h2 className="mini">Lecture notes</h2>
          {notes.length === 0 && (
            <p className="empty">
              {hasGranola()
                ? `No Granola notes matched ${code} yet. Put them in a Granola folder named "${code}", or include ${code} in the note title.`
                : "No notes yet. Paste a Granola summary below to keep it with this course."}
            </p>
          )}
          {notes.map((n) => (
            <Link key={n.id} href={href(n.id)} className={`note-row ${n.id === selectedId ? "on" : ""}`}>
              <span className="note-title">{n.title}</span>
              <span className="muted small">{day(n.createdAt)} · {n.source === "granola" ? "Granola" : "Pasted"}</span>
            </Link>
          ))}
          <NoteTools courseCode={code} removable={note?.source === "import" ? note.id : null} granola={hasGranola()} />
        </aside>

        <article className="card note-reader">
          {noteError && <p className="banner">{noteError}</p>}
          {!note && !noteError && <p className="muted">Pick a note to read its summary.</p>}
          {note && (
            <>
              <div className="row-between">
                <div>
                  <span className="muted small">{day(note.createdAt)}</span>
                  <h2 className="note-heading">{note.title}</h2>
                </div>
                {note.url && <a href={note.url} target="_blank" rel="noreferrer" className="btn">Open in Granola ↗</a>}
              </div>
              <div className="note-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(note.summary) }} />
              {note.transcript.length > 0 && (
                <details className="transcript">
                  <summary>Transcript · {note.transcript.length} lines</summary>
                  {note.transcript.map((t, i) => (
                    <p key={i}>
                      <span className="who">{t.who}{t.at && <span className="muted"> {new Date(t.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}</span>}</span>
                      {t.text}
                    </p>
                  ))}
                </details>
              )}
              {note.transcriptTooLarge && <p className="muted small">This transcript is too long to show here. Open the note in Granola to read it.</p>}
            </>
          )}
        </article>
      </div>
    </>
  );
}
