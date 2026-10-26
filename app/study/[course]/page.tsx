import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs } from "@/components/Doc";
import { getAssignments } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { formatDate } from "@/lib/format";
import { byDay, noteDay, notePreview, noteTitle, type Lecture, type LectureMine } from "@/lib/lectures";
import { listAll } from "@/lib/store";
import { courseFromParam, courseTitle, studyHref } from "@/lib/study";
import NewNote from "../NewNote";

export const dynamic = "force-dynamic";

// A course is just its notes, oldest first. Each note's date sets its place in the list.
export default async function CoursePage({ params }: { params: Promise<{ course: string }> }) {
  const code = courseFromParam((await params).course);
  const [assignments, all, mine] = await Promise.all([getAssignments(), listAll<Lecture>("lectures"), listAll<LectureMine>("lecturemine")]);
  const notes = Object.values(all).filter((l) => l.courseCode === code).sort(byDay);
  const work = assignments.filter((a) => a.courseCode === code);
  if (!work.length && !notes.length) notFound();
  const name = courseTitle(code, work[0]?.course ?? "");

  return (
    <article className="doc">
      <div className="doc-top">
        <Crumbs trail={[{ label: "Study", href: "/study" }, { label: code }]} />
        <div className="doc-actions">
          <NewNote course={code} />
        </div>
      </div>

      <div className="doc-icon course-icon" style={{ ["--c" as string]: courseColor(code) }} aria-hidden>{code.replace(/[^A-Za-z]/g, "").slice(0, 3)}</div>
      <h1 className="doc-title">{code}</h1>
      {name && <p className="doc-sub">{name}</p>}

      <div className="db-list notes-list">
        {notes.map((l) => {
          const preview = notePreview(l, mine[l.id]?.myNotes);
          return (
            <Link key={l.id} href={studyHref(code, l.id)} className="db-row">
              <span className="db-ico" aria-hidden>{l.segments.length ? "🎙️" : "📄"}</span>
              <span className="db-main">
                <span className={`db-title ${l.title.trim() ? "" : "faint"}`}>{noteTitle(l)}</span>
                {preview && <span className="db-preview">{preview}</span>}
              </span>
              <span className="db-meta">{formatDate(noteDay(l))}</span>
            </Link>
          );
        })}
        {!notes.length && <p className="db-empty">No notes yet. Your notes for {code} will be listed here by date.</p>}
        <NewNote course={code} row />
      </div>
    </article>
  );
}
