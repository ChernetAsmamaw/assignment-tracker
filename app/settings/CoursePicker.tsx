"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export interface PickerAssignment {
  id: string;
  name: string;
  due: string;
  submitted: boolean;
}

export interface PickerCourse {
  code: string;
  name: string;
  color: string;
  upcoming: PickerAssignment[];
  past: PickerAssignment[];
}

// Keys map to true to tick a course or assignment, false to untick it.
type Include = { courses?: Record<string, boolean>; assignments?: Record<string, boolean> };
type Off = { courses: Set<string>; assignments: Set<string> };

function apply(cur: Off, include: Include): Off {
  const next = { courses: new Set(cur.courses), assignments: new Set(cur.assignments) };
  for (const [k, on] of Object.entries(include.courses ?? {})) {
    if (on) next.courses.delete(k);
    else next.courses.add(k);
  }
  for (const [k, on] of Object.entries(include.assignments ?? {})) {
    if (on) next.assignments.delete(k);
    else next.assignments.add(k);
  }
  return next;
}

export default function CoursePicker({ courses, initial }: { courses: PickerCourse[]; initial: { courses: string[]; assignments: string[] } }) {
  const [off, setOff] = useState<Off>({ courses: new Set(initial.courses), assignments: new Set(initial.assignments) });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const router = useRouter();
  // Saves run one at a time so quick clicks can't overwrite each other on the server.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const failed = useRef(false);

  const save = (include: Include) => {
    setOff((cur) => apply(cur, include));
    setStatus("saving");
    pending.current++;
    queue.current = queue.current.then(async () => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ include }),
      }).catch(() => null);
      if (!res?.ok) failed.current = true;
      if (--pending.current === 0) {
        setStatus(failed.current ? "error" : "saved");
        failed.current = false;
        router.refresh();
      }
    });
  };

  const toggleOpen = (code: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const q = query.trim().toLowerCase();
  const tracked = courses.filter((c) => !off.courses.has(c.code)).length;
  const unticked = courses
    .filter((c) => !off.courses.has(c.code))
    .reduce((n, c) => n + [...c.upcoming, ...c.past].filter((a) => off.assignments.has(a.id)).length, 0);

  const shown = courses.flatMap((c) => {
    const courseMatch = !q || `${c.code} ${c.name}`.toLowerCase().includes(q);
    const match = (a: PickerAssignment) => courseMatch || a.name.toLowerCase().includes(q);
    const upcoming = c.upcoming.filter(match);
    const past = c.past.filter(match);
    return q && !courseMatch && !upcoming.length && !past.length ? [] : [{ c, upcoming, past }];
  });

  return (
    <>
      <div className="picker-bar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a course or assignment" aria-label="Find a course or assignment" />
        <span className={`small ${status === "error" ? "overdue" : "muted"}`} aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save. Reload to see what's kept." : ""}
        </span>
      </div>
      <p className="small muted" style={{ margin: "0 0 14px" }}>
        {tracked} of {courses.length} course{courses.length === 1 ? "" : "s"} tracked
        {unticked > 0 && ` · ${unticked} assignment${unticked === 1 ? "" : "s"} unticked`}
      </p>

      {shown.length === 0 && <p className="muted">Nothing matches &ldquo;{query}&rdquo;.</p>}

      {shown.map(({ c, upcoming, past }) => {
        const courseOff = off.courses.has(c.code);
        const all = [...c.upcoming, ...c.past];
        const excluded = all.filter((a) => off.assignments.has(a.id));
        const expanded = !!q || open.has(c.code);
        const row = (a: PickerAssignment) => {
          const on = !courseOff && !off.assignments.has(a.id);
          return (
            <li key={a.id} className={on ? "" : "off"}>
              <label>
                <input
                  type="checkbox"
                  className="check"
                  checked={on}
                  disabled={courseOff}
                  onChange={(e) => save({ assignments: { [a.id]: e.target.checked } })}
                />
                <span className="a-name">{a.name}</span>
                <span className="a-meta">{a.submitted ? "Submitted · " : ""}{a.due}</span>
              </label>
            </li>
          );
        };
        return (
          <section key={c.code} className={`card course-pick ${courseOff ? "off" : ""}`} style={{ "--course": c.color } as React.CSSProperties}>
            <div className="cp-head">
              <input
                type="checkbox"
                className="check"
                checked={!courseOff}
                onChange={(e) => save({ courses: { [c.code]: e.target.checked } })}
                aria-label={`Track ${c.code}`}
              />
              <span className="dot" />
              <button type="button" className="cp-name" onClick={() => toggleOpen(c.code)} aria-expanded={expanded}>
                <strong>{c.code}</strong>
                <span className="small muted">{c.name}</span>
              </button>
              <span className="small muted cp-count">
                {courseOff ? "Not tracked" : excluded.length ? `${all.length - excluded.length} of ${all.length} tracked` : `All ${all.length} tracked`}
              </span>
              <button type="button" className="link small cp-toggle" onClick={() => toggleOpen(c.code)} aria-expanded={expanded}>
                {expanded ? "Hide" : "Assignments"}
              </button>
            </div>
            {expanded && (
              <div className="cp-body">
                {courseOff ? (
                  <p className="small muted cp-note">Tick {c.code} to choose which of its assignments to track.</p>
                ) : excluded.length > 0 && (
                  <p className="small cp-note">
                    <button type="button" className="link small" onClick={() => save({ assignments: Object.fromEntries(excluded.map((a) => [a.id, true])) })}>
                      Tick all {all.length} again
                    </button>
                  </p>
                )}
                {upcoming.length > 0 && <ul className={`cp-list ${courseOff ? "disabled" : ""}`}>{upcoming.map(row)}</ul>}
                {past.length > 0 && (
                  <details className="cp-past" key={q ? "search" : "browse"} open={!!q || upcoming.length === 0}>
                    <summary className="small muted">Past due <span className="count">{past.length}</span></summary>
                    <ul className={`cp-list ${courseOff ? "disabled" : ""}`}>{past.map(row)}</ul>
                  </details>
                )}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
