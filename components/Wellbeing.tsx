"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtHours, type PlanItem } from "@/lib/planner";
import { ENERGY_LABEL, type Energy } from "@/lib/wellbeing";

const ENERGIES: Energy[] = [1, 2, 3, 4, 5];
const FACES: Record<Energy, string> = { 1: "◔", 2: "◑", 3: "◕", 4: "●", 5: "✦" };

// Morning check-in: how you feel and how you slept. The planner trims or keeps today to match.
export function CheckInCard({ done, energy, sleep, reply, capacity }: { done: boolean; energy?: Energy; sleep?: number | null; reply?: string; capacity: number }) {
  const [open, setOpen] = useState(!done);
  const [e, setE] = useState<Energy | null>(energy ?? null);
  const [s, setS] = useState(sleep != null ? String(sleep) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(reply ?? "");
  const router = useRouter();

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!e) return;
    setBusy(true);
    const res = await fetch("/api/wellbeing/checkin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ energy: e, sleep: s, note }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setAnswer(body.reply ?? body.error ?? "Saved.");
    setOpen(false);
    router.refresh();
  };

  if (!open)
    return (
      <div className="card checkin done">
        <div className="row-between">
          <span className="ai-badge">✦ Wellbeing agent</span>
          <button type="button" className="link small" onClick={() => setOpen(true)}>Update check-in</button>
        </div>
        <p style={{ margin: "8px 0 0" }}>
          {energy && <strong>{ENERGY_LABEL[energy]} today{sleep != null ? `, ${sleep}h sleep` : ""}. </strong>}
          {answer}
        </p>
        <p className="muted small" style={{ margin: "6px 0 0" }}>Today is planned at {fmtHours(capacity)}.</p>
      </div>
    );

  return (
    <form className="card checkin" onSubmit={send}>
      <span className="ai-badge">✦ Wellbeing agent</span>
      <h2 className="coach-title">How are you today?</h2>
      <div className="energy" role="radiogroup" aria-label="Energy">
        {ENERGIES.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={e === n} className={`e-${n}`} onClick={() => setE(n)}>
            <span className="face" aria-hidden>{FACES[n]}</span>
            {ENERGY_LABEL[n]}
          </button>
        ))}
      </div>
      <div className="checkin-row">
        <label>
          Sleep last night (hours)
          <input type="number" min={0} max={14} step={0.5} value={s} onChange={(ev) => setS(ev.target.value)} placeholder="7" />
        </label>
        <label style={{ flex: 1 }}>
          Anything on your mind? (optional)
          <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. stressed about the CSC263 midterm" />
        </label>
        <button className="primary" disabled={!e || busy}>{busy ? "Replanning…" : "Check in"}</button>
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>Low energy or short sleep makes today lighter and moves the rest to later days.</p>
    </form>
  );
}

// Today's agenda with a focus timer on every block.
export function Agenda({ items }: { items: PlanItem[] }) {
  const [focus, setFocus] = useState<PlanItem | null>(null);
  return (
    <>
      <div className="agenda">
        {items.map((it) => (
          <div key={it.href + it.title} className="agenda-row">
            <Link href={it.href}>
              <span className="h">{fmtHours(it.hours)}</span>
              <span>
                <strong>{it.title}</strong>
                <span className="muted small" style={{ display: "block" }}>
                  {it.courseCode} · {it.name}
                  {it.pace !== 1 && <span title="Time adjusted to how fast you've really worked in this course"> · paced {it.pace}×</span>}
                </span>
              </span>
              <span className={`k ${it.kind}`}>{it.kind === "study" ? "Study" : "Assignment"}</span>
            </Link>
            <button type="button" className="focus-btn" onClick={() => setFocus(it)} aria-label={`Focus on ${it.title}`} title="Start a focus session">▶</button>
          </div>
        ))}
      </div>
      {focus && <FocusTimer item={focus} onClose={() => setFocus(null)} />}
    </>
  );
}

const WORK = 25 * 60;
const BREAK = 5 * 60;
const KEY = "pace:focus";

// Pomodoro-style timer: 25 minutes on, 5 off, counting only focused time. The result teaches
// the planner how long work in this course really takes you.
function FocusTimer({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const [focused, setFocused] = useState(0); // seconds of work
  const [phase, setPhase] = useState<"work" | "break">("work");
  const [phaseLeft, setPhaseLeft] = useState(WORK);
  const [running, setRunning] = useState(true);
  const [ending, setEnding] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const planned = Math.round(item.hours * 60);

  // Survive a reload of the page within the same block.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved?.id === item.href + item.title && Date.now() - saved.at < 6 * 3600_000) setFocused(saved.focused);
    } catch {}
  }, [item]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ id: item.href + item.title, focused, at: Date.now() }));
    } catch {}
  }, [focused, item]);

  useEffect(() => {
    if (!running || ending) return;
    const t = setInterval(() => {
      if (phase === "work") setFocused((f) => f + 1);
      setPhaseLeft((l) => {
        if (l > 1) return l - 1;
        const next = phase === "work" ? "break" : "work";
        setPhase(next);
        return next === "work" ? WORK : BREAK;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, phase, ending]);

  const finish = async (completed: boolean, stepDone: boolean) => {
    setSaving(true);
    await fetch("/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assignmentId: item.assignmentId,
        courseCode: item.courseCode,
        title: item.title,
        plannedMinutes: Math.round(planned / (item.pace || 1)),
        minutes: Math.round(focused / 60),
        completed,
        stepDone,
      }),
    }).catch(() => {});
    try {
      localStorage.removeItem(KEY);
    } catch {}
    router.refresh();
    onClose();
  };

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const pct = Math.min(100, (focused / 60 / Math.max(1, planned)) * 100);

  return (
    <div className="cmd-backdrop">
      <div className="cmd focus" role="dialog" aria-label="Focus session">
        <span className="agent-tag">{phase === "work" ? "◉ Focus" : "☕ Break"} · {item.courseCode}</span>
        <h2 style={{ margin: "6px 0 2px" }}>{item.title}</h2>
        <p className="muted small" style={{ margin: 0 }}>{item.name}</p>
        <div className={`focus-clock ${phase}`}>{mm(phaseLeft)}</div>
        <div className="meter" title={`${Math.round(focused / 60)} of ${planned} minutes`}><span style={{ width: `${pct}%` }} /></div>
        <p className="muted small" style={{ margin: "6px 0 14px" }}>
          {Math.round(focused / 60)} of {planned} planned minutes focused{phase === "break" ? ". Stand up, drink some water." : ""}
        </p>
        {!ending ? (
          <div className="row-between">
            <button type="button" onClick={() => setRunning((r) => !r)}>{running ? "Pause" : "Resume"}</button>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="link" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" onClick={() => setEnding(true)}>I&apos;m done</button>
            </span>
          </div>
        ) : (
          <div className="focus-end">
            <strong>How did it go?</strong>
            <button type="button" className="primary" disabled={saving} onClick={() => finish(true, false)}>Finished this block</button>
            {item.kind === "assignment" && item.title !== "Keep working" && (
              <button type="button" disabled={saving} onClick={() => finish(true, true)}>Finished the whole step: check it off</button>
            )}
            <button type="button" disabled={saving} onClick={() => finish(false, false)}>Stopping for now, not finished</button>
            <p className="muted small" style={{ margin: 0 }}>Finished blocks teach your planner how long work in {item.courseCode} really takes you.</p>
          </div>
        )}
      </div>
    </div>
  );
}
