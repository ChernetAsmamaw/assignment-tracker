"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewLecture({ courses, course }: { courses: string[]; course: string }) {
  const [f, setF] = useState({ courseCode: course || courses[0] || "", title: "" });
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const title = f.title.trim() || `Lecture, ${new Date().toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
    const res = await fetch("/api/lectures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, title }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setBusy(false);
    router.push(`/lectures/${body.id}`);
  };
  return (
    <form onSubmit={submit} className="form-grid">
      <label>Course
        <input list="lec-courses" value={f.courseCode} onChange={(e) => setF({ ...f, courseCode: e.target.value })} required />
        <datalist id="lec-courses">{courses.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label>Class
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Week 7: Hash tables" />
      </label>
      <div className="full">
        <button className="primary" disabled={busy}>{busy ? "Opening…" : "● Start a class"}</button>
        <span className="muted small" style={{ marginLeft: 10 }}>You&apos;ll press record on the next screen.</span>
      </div>
    </form>
  );
}
