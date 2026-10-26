"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewPlanForm({ courses, initial, gemini }: { courses: string[]; initial: { course: string; title: string; topics: string }; gemini: boolean }) {
  const [f, setF] = useState({ courseCode: initial.course, title: initial.title || "Midterm", date: "", time: "09:00", topics: initial.topics, notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    // Exams are in Toronto time; let the browser turn the local date and time into an instant.
    const examAt = new Date(`${f.date}T${f.time}`).toISOString();
    const res = await fetch("/api/study", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: f.title, courseCode: f.courseCode, examAt, topics: f.topics, notes: f.notes }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "Something went wrong.");
    router.push(`/study/${body.id}`);
    router.refresh();
  };
  return (
    <form onSubmit={submit} className="form-grid">
      <label>Course
        <input list="courses" value={f.courseCode} onChange={(e) => setF({ ...f, courseCode: e.target.value })} required />
        <datalist id="courses">{courses.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label>Exam
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Midterm 2" required />
      </label>
      <label>Date
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      </label>
      <label>Start time
        <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
      </label>
      <label className="full">Topics {gemini && <span className="muted">(optional: leave empty and Gemini works them out from your course)</span>}
        <input value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} placeholder="Heaps, AVL trees, hashing, amortized analysis" />
      </label>
      <label className="full">Anything else
        <textarea style={{ minHeight: 80 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Paste the exam coverage from the syllabus, or say what feels weak" />
      </label>
      <div className="full">
        <button className="primary" disabled={busy}>{busy ? "Building your timeline…" : gemini ? "✦ Build my study plan" : "Build my study plan"}</button>
        {err && <span className="small overdue" style={{ marginLeft: 10 }}>{err}</span>}
      </div>
    </form>
  );
}
