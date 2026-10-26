"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDay } from "@/lib/format";
import { studyHref } from "@/lib/study";

// "Record a class": pick the course, then the new class page opens ready to record.
export default function NewClass({ courses }: { courses: { code: string; color: string }[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const router = useRouter();
  const start = async (courseCode: string) => {
    setBusy(courseCode);
    const title = `Class on ${formatDay(new Date().toISOString()).replace(/^\w+, /, "")}`;
    const res = await fetch("/api/lectures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseCode, title }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setBusy("");
    router.push(studyHref(courseCode, body.id));
  };
  return (
    <div className="menu-wrap">
      <button type="button" className="ghost" onClick={() => setOpen(!open)} aria-expanded={open}><span className="rec-dot small" /> Record a class</button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-label">Which course?</div>
            {courses.map((c) => (
              <button key={c.code} type="button" role="menuitem" onClick={() => start(c.code)} disabled={!!busy}>
                <span className="dot" style={{ background: c.color }} /> {busy === c.code ? "Opening…" : c.code}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
