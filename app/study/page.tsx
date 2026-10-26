import Link from "next/link";
import { Crumbs } from "@/components/Doc";
import { getAssignments } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { formatDate } from "@/lib/format";
import { byDay, noteDay, notePreview, noteTitle, type Lecture, type LectureMine } from "@/lib/lectures";
import { listAll } from "@/lib/store";
import { courseTitle, studyHref } from "@/lib/study";
import NewNote from "./NewNote";

export const dynamic = "force-dynamic";

export default async function StudyPage() {
  const [assignments, all, mine] = await Promise.all([getAssignments(), listAll<Lecture>("lectures"), listAll<LectureMine>("lecturemine")]);
  const notes = Object.values(all).sort(byDay);
  const codes = [...new Set([...assignments.map((a) => a.courseCode), ...notes.map((l) => l.courseCode)])].filter(Boolean).sort();
  const recent = [...notes].reverse().slice(0, 6);

  return (
    <article className="doc">
      <div className="doc-top">
        <Crumbs trail={[{ label: "Study" }]} />
        <div className="doc-actions">
          <NewNote courses={codes.map((code) => ({ code, color: courseColor(code) }))} />
        </div>
      </div>

      <div className="doc-icon" aria-hidden>📚</div>
      <h1 className="doc-title">Study</h1>
      <p className="doc-sub">Your notes for each course. Open a course to see its notes in date order.</p>

      <h2>Courses</h2>
      <div className="g-cards">
        {codes.map((code) => {
          const mineFor = notes.filter((l) => l.courseCode === code);
          const latest = mineFor.at(-1);
          return (
            <Link key={code} href={studyHref(code)} className="g-card" style={{ ["--c" as string]: courseColor(code) }}>
              <span className="g-cover" aria-hidden />
              <span className="g-body">
                <strong>{code}</strong>
                <span className="g-name">{courseTitle(code, assignments.find((a) => a.courseCode === code)?.course ?? "") || " "}</span>
                <span className="g-line">{mineFor.length ? `${mineFor.length} note${mineFor.length === 1 ? "" : "s"}` : "No notes yet"}</span>
                <span className="g-line faint">{latest ? `Latest ${formatDate(noteDay(latest))}` : " "}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {recent.length > 0 && (
        <>
          <h2>Recent notes</h2>
          <div className="db-list">
            {recent.map((l) => {
              const preview = notePreview(l, mine[l.id]?.myNotes);
              return (
                <Link key={l.id} href={studyHref(l.courseCode, l.id)} className="db-row">
                  <span className="db-ico" aria-hidden>{l.segments.length ? "🎙️" : "📄"}</span>
                  <span className="db-main">
                    <span className={`db-title ${l.title.trim() ? "" : "faint"}`}>{noteTitle(l)}</span>
                    {preview && <span className="db-preview">{preview}</span>}
                  </span>
                  <span className="db-meta">{l.courseCode} · {formatDate(noteDay(l))}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}
