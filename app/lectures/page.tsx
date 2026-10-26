import Link from "next/link";
import { getAssignments } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { hasGemini } from "@/lib/gemini";
import { clock, type Lecture } from "@/lib/lectures";
import { listAll } from "@/lib/store";
import NewLecture from "./NewLecture";

export const dynamic = "force-dynamic";

export default async function LecturesPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course } = await searchParams;
  const [all, assignments] = await Promise.all([listAll<Lecture>("lectures"), getAssignments().catch(() => [])]);
  const lectures = Object.values(all).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const courses = [...new Set([...assignments.map((a) => a.courseCode), ...lectures.map((l) => l.courseCode)].filter(Boolean))].sort();
  const shown = course ? lectures.filter((l) => l.courseCode === course) : lectures;
  const groups = [...new Set(shown.map((l) => l.courseCode))].sort();

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Class recorder</span>
          <h1>Class notes</h1>
          <p>Record a class and get a transcript, a summary and notes by topic. Every note comes from something that was said: hover it to see the exact words.</p>
        </div>
      </header>

      <div className="card coach">
        <span className="ai-badge">{hasGemini() ? "✦ Transcribed and written by Gemini" : "Live captions"}</span>
        <h2 className="coach-title">Record a class</h2>
        <NewLecture courses={courses} course={course ?? ""} />
      </div>

      {courses.length > 0 && lectures.length > 0 && (
        <nav className="filters" style={{ margin: "20px 0 4px" }}>
          <Link href="/lectures" className={!course ? "on" : ""}>All</Link>
          {courses.filter((c) => lectures.some((l) => l.courseCode === c)).map((c) => (
            <Link key={c} href={`/lectures?course=${encodeURIComponent(c)}`} className={course === c ? "on" : ""}>{c}</Link>
          ))}
        </nav>
      )}

      {shown.length === 0 && lectures.length > 0 && <p className="empty">No classes recorded for {course} yet.</p>}

      {groups.map((code) => (
        <section key={code}>
          <div className="section-title"><span className="dot" style={{ background: courseColor(code) }} />{code || "No course"}</div>
          <div className="lec-cards">
            {shown.filter((l) => l.courseCode === code).map((l) => (
              <Link key={l.id} href={`/lectures/${l.id}`} className="lec-card" style={{ ["--course" as string]: courseColor(l.courseCode) }}>
                <span className="muted small">
                  {new Date(l.createdAt).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}
                  {l.duration > 0 && ` · ${clock(l.duration)}`}
                </span>
                <strong>{l.title}</strong>
                <span className="small lec-card-sum">
                  {l.notes?.summary[0]?.text ?? (l.segments.length ? `${l.segments.length} transcript lines, notes not written yet` : "Not recorded yet")}
                </span>
                {l.notes && (
                  <span className="muted small">
                    {l.notes.sections.length} topic{l.notes.sections.length === 1 ? "" : "s"}
                    {l.notes.actions.length > 0 && ` · ${l.notes.actions.length} to do`}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
