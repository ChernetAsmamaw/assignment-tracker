"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Coaching } from "@/lib/ai";
import type { Settings } from "@/lib/store";

export function CoachCard({ gemini }: { gemini: boolean }) {
  const [c, setC] = useState<Coaching | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/ai/coach", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setC)
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="card coach">
      <div className="coach-head">
        <span className="ai-badge">{gemini ? "✦ Gemini coach" : "Coach"}</span>
      </div>
      {!c && !failed && <p className="muted shimmer">Reading your week…</p>}
      {failed && <p className="muted small">The coach couldn&apos;t load right now. Your plan below is still up to date.</p>}
      {c && (
        <>
          <h2 className="coach-title">{c.headline}</h2>
          <p style={{ margin: "0 0 8px" }}>{c.message}</p>
          {c.tips.length > 0 && <ul className="tips">{c.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

export function HoursForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
    setBusy(false);
    router.refresh();
  };
  return (
    <form className="hours" onSubmit={save}>
      <label>
        Weekdays (hours)
        <input type="number" min={0} max={16} step={0.5} value={s.weekdayHours} onChange={(e) => setS({ ...s, weekdayHours: Number(e.target.value) })} />
      </label>
      <label>
        Weekends (hours)
        <input type="number" min={0} max={16} step={0.5} value={s.weekendHours} onChange={(e) => setS({ ...s, weekendHours: Number(e.target.value) })} />
      </label>
      <button className="primary" disabled={busy}>{busy ? "Replanning…" : "Replan"}</button>
    </form>
  );
}

export function EstimateButton({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const run = async () => {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/ai/estimate", { method: "POST" });
    setBusy(false);
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
    else router.refresh();
  };
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" onClick={run} disabled={busy}>
        {busy ? "Estimating…" : `✦ Estimate ${count} with Gemini`}
      </button>
      {err && <span className="small overdue" style={{ marginLeft: 10 }}>{err}</span>}
    </div>
  );
}
