"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { studyHref } from "@/lib/study";

// "New note": makes an empty note dated today and opens it. Without a course it asks which one first.
export default function NewNote({ course, courses, row }: { course?: string; courses?: { code: string; color: string }[]; row?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();

  const create = async (courseCode: string) => {
    setBusy(courseCode);
    setErr("");
    const res = await fetch("/api/lectures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseCode }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setBusy("");
      setOpen(false);
      return setErr(body?.error ?? "Couldn't make a note. Check your connection and try again.");
    }
    router.push(studyHref(courseCode, body.id));
  };

  const error = err && (
    <div className="new-err" role="alert">
      <span>{err}</span>
      <button type="button" className="ghost" onClick={() => setErr("")} aria-label="Dismiss">×</button>
    </div>
  );

  if (course)
    return (
      <div className="menu-wrap">
        <button type="button" className={row ? "db-new" : "ghost"} onClick={() => create(course)} disabled={!!busy}>
          {busy ? "Opening…" : "+ New note"}
        </button>
        {error}
      </div>
    );

  return (
    <div className="menu-wrap">
      <button type="button" className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>+ New note</button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-label">Which course?</div>
            {(courses ?? []).map((c) => (
              <button key={c.code} type="button" role="menuitem" onClick={() => create(c.code)} disabled={!!busy}>
                <span className="dot" style={{ background: c.color }} /> {busy === c.code ? "Opening…" : c.code}
              </button>
            ))}
          </div>
        </>
      )}
      {error}
    </div>
  );
}
