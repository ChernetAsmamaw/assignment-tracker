import { courseStats, topicsFor } from "@/lib/agents/performance";
import { courseColor } from "@/lib/colors";
import { loadAll } from "@/lib/data";
import { hasGemini } from "@/lib/gemini";
import { isDemo } from "@/lib/canvas";
import { Insights, Quiz } from "./PerformanceClient";

export const dynamic = "force-dynamic";

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ course?: string; topic?: string }> }) {
  const q = await searchParams;
  const { assignments, progress, mastery } = await loadAll();
  const stats = courseStats(assignments, progress).sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  const topics = topicsFor(mastery);
  const courses = stats.map((s) => s.courseCode);
  const ranked = [...mastery].sort((a, b) => a.score - b.score);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Performance agent</span>
          <h1>How you&apos;re doing</h1>
          <p>Your Quercus grades and topic mastery, read by an agent that tells you where to focus and quizzes you to build proficiency.</p>
        </div>
      </header>
      {isDemo() && <div className="banner">Sample grades shown. Add your Quercus token to see yours.</div>}

      <section className="course-stats" style={{ marginBottom: 18 }}>
        {stats.map((s) => (
          <div key={s.courseCode} className="cstat" style={{ borderTop: `4px solid ${courseColor(s.courseCode)}` }}>
            <span className="muted small">{s.courseCode}</span>
            <span className="big">{s.average != null ? `${s.average}%` : "–"}</span>
            <span className="small">
              {s.trend != null && (
                <span className={s.trend >= 0 ? "trend-up" : "trend-down"}>{s.trend >= 0 ? "▲" : "▼"} {Math.abs(s.trend)} pts latest · </span>
              )}
              {s.graded} graded
            </span>
            <span className="muted small">
              {s.open} open{s.late ? ` · ${s.late} late` : ""}{s.missed ? ` · ${s.missed} missed` : ""}
            </span>
          </div>
        ))}
      </section>

      <div className="two-col">
        <div>
          <Insights gemini={hasGemini()} />
          <Quiz gemini={hasGemini()} courses={courses} topics={topics} initial={{ course: q.course ?? courses[0] ?? "", topic: q.topic ?? "" }} />
        </div>
        <div className="card">
          <h2>Topic mastery</h2>
          {ranked.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Take a quiz to start measuring your proficiency.</p>
          ) : (
            ranked.map((m) => (
              <div key={m.key} className="mastery-row">
                <span>
                  <strong style={{ fontSize: 14 }}>{m.topic}</strong>
                  <span className="muted small" style={{ display: "block" }}>{m.courseCode} · {m.attempts} quiz{m.attempts === 1 ? "" : "zes"}</span>
                </span>
                <div className="meter"><span style={{ width: `${m.score}%` }} /></div>
                <strong className={m.score < 60 ? "overdue" : ""} style={{ textAlign: "right" }}>{m.score}%</strong>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
