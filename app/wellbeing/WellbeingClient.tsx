"use client";

import { useEffect, useState } from "react";
import type { WellbeingNote } from "@/lib/agents/wellbeing";

export function WellbeingCoach({ gemini }: { gemini: boolean }) {
  const [n, setN] = useState<WellbeingNote | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/wellbeing/note", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setN)
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="card coach">
      <span className="ai-badge">{gemini ? "✦ Wellbeing agent · Gemini" : "Wellbeing agent"}</span>
      {!n && !failed && <p className="muted shimmer">Reading your week…</p>}
      {failed && <p className="muted small">The coach couldn&apos;t load right now. Your numbers below are up to date.</p>}
      {n && (
        <>
          <h2 className="coach-title">{n.headline}</h2>
          <p style={{ margin: "0 0 8px" }}>{n.message}</p>
          {n.actions.length > 0 && <ul className="tips">{n.actions.map((t) => <li key={t}>{t}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

export function CalendarLink({ base }: { base: string }) {
  const [copied, setCopied] = useState(false);
  const [start, setStart] = useState(17);
  const url = start === 17 ? base : `${base}?start=${start}`;
  const webcal = url.replace(/^https?:/, "webcal:");
  return (
    <div className="cal-link">
      <select value={start} onChange={(e) => setStart(Number(e.target.value))} aria-label="Blocks start at" style={{ width: "auto" }}>
        {Array.from({ length: 15 }, (_, i) => i + 7).map((h) => (
          <option key={h} value={h}>Start {h === 12 ? "12 pm" : h > 12 ? `${h - 12} pm` : `${h} am`}</option>
        ))}
      </select>
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Calendar feed URL" />
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <a className="button" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">Add to Google Calendar</a>
      <a className="button" href={webcal}>Apple / Outlook</a>
    </div>
  );
}
