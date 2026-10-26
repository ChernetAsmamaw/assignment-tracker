"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Insight, Question } from "@/lib/agents/performance";

export function Insights({ gemini }: { gemini: boolean }) {
  const [data, setData] = useState<{ insights: Insight[]; focus: string } | null>(null);
  useEffect(() => {
    fetch("/api/performance/insights", { method: "POST" }).then((r) => r.json()).then(setData).catch(() => setData({ insights: [], focus: "" }));
  }, []);
  return (
    <div className="card coach">
      <span className="ai-badge">{gemini ? "✦ Performance agent · Gemini" : "Performance agent"}</span>
      {!data && <p className="muted shimmer">Reading your grades…</p>}
      {data && (
        <>
          {data.focus && <h2 className="coach-title">{data.focus}</h2>}
          {data.insights.map((i) => (
            <div key={i.title} className="insight">
              <span className={`bar-v tone-${i.tone}`} />
              <span>
                <strong>{i.title}</strong>
                <span className="small" style={{ display: "block" }}>{i.detail}</span>
              </span>
            </div>
          ))}
          {data.insights.length === 0 && <p className="muted small">Not enough graded work yet for insights.</p>}
        </>
      )}
    </div>
  );
}

export function Quiz({ gemini, courses, topics, initial }: {
  gemini: boolean; courses: string[]; topics: { courseCode: string; topic: string }[]; initial: { course: string; topic: string };
}) {
  const [course, setCourse] = useState(initial.course);
  const [topic, setTopic] = useState(initial.topic);
  const [qs, setQs] = useState<Question[] | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  const save = async (result: number) => {
    await fetch("/api/performance/mastery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseCode: course, topic, result }) });
    router.refresh();
  };
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setBusy(true);
    setErr("");
    setQs(null);
    setPicks({});
    setChecked(false);
    const res = await fetch("/api/performance/quiz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseCode: course, topic }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "Something went wrong.");
    setQs(body.questions);
  };
  const check = () => {
    if (!qs) return;
    setChecked(true);
    save(Math.round((qs.filter((q, i) => picks[i] === q.answer).length / qs.length) * 100));
  };
  const score = qs ? Math.round((qs.filter((q, i) => picks[i] === q.answer).length / qs.length) * 100) : 0;
  const suggestions = topics.filter((t) => !course || t.courseCode === course);

  return (
    <div className="card">
      <h2>{gemini ? "✦ Quiz me" : "Rate your confidence"}</h2>
      <form onSubmit={start} className="add-step" style={{ flexWrap: "wrap" }}>
        <select value={course} onChange={(e) => setCourse(e.target.value)} style={{ width: 130 }}>
          {courses.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input list="topics" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic, e.g. AVL tree rotations" style={{ flex: 1, minWidth: 180 }} />
        <datalist id="topics">{suggestions.map((t) => <option key={t.courseCode + t.topic} value={t.topic} />)}</datalist>
        {gemini && <button className="primary" disabled={busy}>{busy ? "Writing questions…" : "Start quiz"}</button>}
      </form>
      {err && <p className="small overdue">{err}</p>}

      {!gemini && (
        <div style={{ marginTop: 12 }}>
          <p className="muted small" style={{ margin: "0 0 8px" }}>How well could you explain this topic right now?</p>
          <div className="seg">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" disabled={!topic.trim()} onClick={() => save(n * 20)}>{["Lost", "Shaky", "OK", "Good", "Solid"][n - 1]}</button>
            ))}
          </div>
        </div>
      )}

      {qs && qs.length === 0 && <p className="muted small">No questions came back. Try a more specific topic.</p>}
      {qs && qs.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {qs.map((q, i) => (
            <div key={i} className="quiz-q">
              <strong>{i + 1}. {q.q}</strong>
              <div className="opts">
                {q.options.map((o, j) => {
                  const cls = checked ? (j === q.answer ? "right" : picks[i] === j ? "wrong" : "") : picks[i] === j ? "picked" : "";
                  return <button key={j} type="button" className={cls} disabled={checked} onClick={() => setPicks({ ...picks, [i]: j })}>{o}</button>;
                })}
              </div>
              {checked && <p className="small muted" style={{ margin: "6px 0 0" }}>{q.explain}</p>}
            </div>
          ))}
          {!checked ? (
            <button className="primary" type="button" onClick={check} disabled={Object.keys(picks).length < qs.length}>Check answers</button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <div className="score-ring" style={{ ["--v" as string]: score }}><span>{score}%</span></div>
              <p style={{ margin: 0 }}>Saved to your mastery for <strong>{topic}</strong>. {score < 60 ? "Review it and try again tomorrow." : score < 80 ? "Getting there. One more review will lock it in." : "Strong. You can mark it understood on your Study page."}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
