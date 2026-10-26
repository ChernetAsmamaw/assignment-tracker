"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Paste a Granola summary into a course, or remove a pasted one.
export default function NoteTools({ courseCode, removable, granola }: { courseCode: string; removable: string | null; granola: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", date: "", url: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const base = `/study/course/${encodeURIComponent(courseCode)}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, courseCode }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? "Something went wrong.");
    setF({ title: "", date: "", url: "", summary: "" });
    setOpen(false);
    router.push(`${base}?note=${body.id}`);
    router.refresh();
  };
  const remove = async () => {
    if (!removable || !confirm("Remove this pasted note?")) return;
    await fetch(`/api/notes/${removable}`, { method: "DELETE" });
    router.push(base);
    router.refresh();
  };

  return (
    <div className="note-tools">
      {!open && <button type="button" className="add-opp" onClick={() => setOpen(true)}>+ {granola ? "Paste a note by hand" : "Add a Granola note"}</button>}
      {open && (
        <form onSubmit={save} className="stack card" style={{ marginTop: 8 }}>
          <p className="muted small" style={{ margin: 0 }}>In Granola, open the note and copy the summary (and the share link if you want one). Paste it here.</p>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Lecture 7: Hashing (optional)" />
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Lecture date" />
          <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://notes.granola.ai/… (optional)" />
          <textarea required style={{ minHeight: 160 }} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="Paste the summary" />
          <div>
            <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save note"}</button>
            <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: 8 }}>Cancel</button>
            {err && <span className="small overdue" style={{ marginLeft: 10 }}>{err}</span>}
          </div>
        </form>
      )}
      {removable && <button type="button" className="link small" style={{ marginTop: 8 }} onClick={remove}>Remove the open note</button>}
    </div>
  );
}
