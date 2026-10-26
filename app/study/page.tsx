import Link from "next/link";
import { loadAll } from "@/lib/data";
import { hasGemini } from "@/lib/gemini";
import { formatDue } from "@/lib/format";
import { courseColor } from "@/lib/colors";
import { clock, type Lecture } from "@/lib/lectures";
import { listAll } from "@/lib/store";
import NewPlanForm from "./NewPlanForm";

export const dynamic = "force-dynamic";

export default async function StudyPage({ searchParams }: { searchParams: Promise<{ course?: string; title?: string; topics?: string }> }) {
  const q = await searchParams;
  const [{ assignments, studyPlans }, lectureMap] = await Promise.all([loadAll(), listAll<Lecture>("lectures")]);
  const lectures = Object.values(lectureMap).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const courses = [...new Set(assignments.map((a) => a.courseCode))].sort();
  const noteCourses = [...new Set([...courses, ...lectures.map((l) => l.courseCode).filter(Boolean)])].sort();
  const now = Date.now();
  const upcoming = studyPlans.filter((p) => new Date(p.examAt).getTime() > now);
  const past = studyPlans.filter((p) => new Date(p.examAt).getTime() <= now);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Study Plan agent</span>
          <h1>Exam study plans</h1>
          <p>Tell it the exam and topics. It builds a day-by-day timeline using spaced repetition, active recall and mock exams, and puts the sessions in your planner.</p>
        </div>
      </header>

      <section className="course-notes">
        {noteCourses.map((code) => {
          const mine = lectures.filter((l) => l.courseCode === code);
          const last = mine[0];
          const exams = upcoming.filter((p) => p.courseCode === code).length;
          return (
            <Link key={code} href={`/lectures?course=${encodeURIComponent(code)}`} className="course-tile" style={{ ["--course" as string]: courseColor(code) }}>
              <strong>{code}</strong>
              <span className="small">
                {mine.length ? `${mine.length} class${mine.length === 1 ? "" : "es"} of notes` : "No class notes yet"}
                {exams > 0 && ` · ${exams} exam${exams === 1 ? "" : "s"} planned`}
              </span>
              <span className="muted small course-tile-last">
                {last ? `Last: ${last.title}${last.duration ? ` (${clock(last.duration)})` : ""}` : "Record a class →"}
              </span>
            </Link>
          );
        })}
      </section>

      {upcoming.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div className="plan-cards">
            {upcoming.map((p) => {
              const done = p.sessions.filter((s) => s.done).length;
              const days = Math.ceil((new Date(p.examAt).getTime() - now) / 864e5);
              return (
                <Link key={p.id} href={`/study/${p.id}`} className="plan-card" style={{ borderTop: `4px solid ${courseColor(p.courseCode)}` }}>
                  <span className="muted small">{p.courseCode} · {formatDue(p.examAt)}</span>
                  <strong style={{ fontSize: 18, fontFamily: "var(--display)" }}>{p.title}</strong>
                  <span className="small">{days} day{days === 1 ? "" : "s"} to go · {p.topics.length} topics</span>
                  <div className="meter"><span style={{ width: `${(done / Math.max(1, p.sessions.length)) * 100}%` }} /></div>
                  <span className="muted small">{done} of {p.sessions.length} sessions done</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="card coach">
        <span className="ai-badge">{hasGemini() ? "✦ Study Plan agent · Gemini" : "Study Plan agent"}</span>
        <h2 className="coach-title">Plan a new exam</h2>
        <NewPlanForm courses={courses} initial={{ course: q.course ?? courses[0] ?? "", title: q.title ?? "", topics: q.topics ?? "" }} gemini={hasGemini()} />
      </div>

      {past.length > 0 && (
        <p className="muted small">
          Past exams: {past.map((p) => <Link key={p.id} href={`/study/${p.id}`} style={{ marginRight: 10 }}>{p.courseCode} {p.title}</Link>)}
        </p>
      )}
    </>
  );
}
