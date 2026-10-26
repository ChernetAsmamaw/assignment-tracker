import Link from "next/link";
import { loadAll } from "@/lib/data";
import { hasGemini } from "@/lib/gemini";
import { formatDue } from "@/lib/format";
import { courseColor } from "@/lib/colors";
import { hasGranola, notesByCourse } from "@/lib/granola";
import NewPlanForm from "./NewPlanForm";

export const dynamic = "force-dynamic";

export default async function StudyPage({ searchParams }: { searchParams: Promise<{ course?: string; title?: string; topics?: string }> }) {
  const q = await searchParams;
  const { assignments, studyPlans } = await loadAll();
  const courses = [...new Set(assignments.map((a) => a.courseCode))].sort();
  const names = new Map(assignments.map((a) => [a.courseCode, a.course]));
  const { notes, error } = await notesByCourse(courses);
  const spaces = [...new Set([...courses, ...studyPlans.map((p) => p.courseCode), ...Object.keys(notes)])].sort();
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

      {spaces.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 className="mini" style={{ margin: 0 }}>Your courses</h2>
            <span className="muted small">{hasGranola() ? (error ? `Granola: ${error}` : "Lecture notes synced from Granola") : "Open a course to add your Granola notes"}</span>
          </div>
          <div className="course-tiles">
            {spaces.map((code) => {
              const list = notes[code] ?? [];
              const exam = upcoming.find((p) => p.courseCode === code);
              return (
                <Link key={code} href={`/study/course/${encodeURIComponent(code)}`} className="course-tile" style={{ "--c": courseColor(code) } as React.CSSProperties}>
                  <span className="course-tile-code">{code}</span>
                  <span className="course-tile-name">{names.get(code)?.replace(/^[^:]*:\s*/, "") ?? "Course"}</span>
                  <span className="course-tile-foot">
                    <span>{list.length} note{list.length === 1 ? "" : "s"}{list[0] ? ` · last ${new Date(list[0].createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}</span>
                    {exam && <span className="course-tile-exam">{exam.title} · {new Date(exam.examAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" })}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

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
