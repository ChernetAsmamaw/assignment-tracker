"use client";

import { useEffect, useRef, useState } from "react";
import type { Breakdown, Suggestion } from "@/lib/ai";
import { STATUS_LABEL, percentFromSteps, type Kind, type Progress, type Resource, type Status, type Step } from "@/lib/types";

const fmtH = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : `${+h.toFixed(2)}h`);

export default function Editor({ id, initial, quercusGroup, gemini }: { id: string; initial: Progress; quercusGroup: boolean; gemini: boolean }) {
  const [p, setP] = useState<Progress>(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draft, setDraft] = useState({ title: "", url: "", note: "" });
  const first = useRef(true);

  // Autosave shortly after each change.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaved("saving");
    const t = setTimeout(async () => {
      const res = await fetch(`/api/assignments/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      setSaved(res.ok ? "saved" : "error");
    }, 600);
    return () => clearTimeout(t);
  }, [p, id]);

  const update = (patch: Partial<Progress>) => setP((cur) => ({ ...cur, ...patch }));

  const setStatus = (status: Status) =>
    update({ status, percent: status === "done" ? 100 : status === "not_started" ? 0 : Math.max(p.percent, 10) });

  const addResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title && !draft.url) return;
    let url = draft.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const r: Resource = { id: crypto.randomUUID(), title: draft.title.trim() || url, url, note: draft.note.trim() };
    update({ resources: [...p.resources, r] });
    setDraft({ title: "", url: "", note: "" });
  };

  const kind: Kind = p.kind ?? (quercusGroup ? "group" : "individual");

  // Steps drive progress: checking one off updates the percent and status.
  const setSteps = (steps: Step[]) => {
    const percent = percentFromSteps(steps);
    update({ steps, percent, status: steps.length === 0 ? p.status : percent === 100 ? "done" : percent === 0 ? "not_started" : "in_progress" });
  };

  return (
    <>
      <StepsCard p={p} id={id} gemini={gemini} setSteps={setSteps} setGuide={(guide) => update({ guide })} />
      <div className="card">
        <h2>Type</h2>
        <div className="seg">
          {(["individual", "group"] as Kind[]).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => update({ kind: k })}>
              {k === "group" ? "Group" : "Individual"}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          {p.kind ? "Set by you." : `From Quercus${quercusGroup ? " (group assignment)" : ""}.`}
          {p.kind && <> <button type="button" className="link small" onClick={() => update({ kind: null })}>Use Quercus setting</button></>}
        </p>
      </div>

      <div className="card">
        <h2>Progress</h2>
        <div className="seg" style={{ marginBottom: 14 }}>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button key={s} type="button" aria-pressed={p.status === s} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <label htmlFor="pct">{p.percent}% complete{p.steps.length > 0 && " · follows your checked steps"}</label>
        <input
          id="pct" type="range" min={0} max={100} step={5} value={p.percent} disabled={p.steps.length > 0}
          onChange={(e) => {
            const percent = Number(e.target.value);
            update({ percent, status: percent === 100 ? "done" : percent === 0 ? "not_started" : "in_progress" });
          }}
          style={{ padding: 0 }}
        />
      </div>

      <div className="card">
        <h2>Resources · {p.resources.length}</h2>
        {p.resources.length === 0 && <p className="muted small" style={{ margin: 0 }}>Readings, links, lecture slides, anything you used.</p>}
        <div>
          {p.resources.map((r) => (
            <div key={r.id} className="res">
              <div>
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : <strong>{r.title}</strong>}
                {r.note && <div className="muted small">{r.note}</div>}
              </div>
              <button type="button" className="link small" onClick={() => update({ resources: p.resources.filter((x) => x.id !== r.id) })}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <ResourceFinder id={id} gemini={gemini} have={p.resources.map((r) => r.url)} onAdd={(r) => update({ resources: [...p.resources, { id: crypto.randomUUID(), title: r.title, url: r.url, note: r.note }] })} />
        <form className="res-form" onSubmit={addResource}>
          <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="Link (optional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <input className="full" placeholder="Note, e.g. page numbers or how you used it" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <div className="full"><button className="primary">Add resource</button></div>
        </form>
      </div>

      <AskCard id={id} gemini={gemini} />

      <div className="card">
        <h2>Notes</h2>
        <textarea value={p.notes} placeholder="Plan, outline, questions for office hours…" onChange={(e) => update({ notes: e.target.value })} />
      </div>

      <p className="small muted">
        {saved === "saving" && "Saving…"}
        {saved === "saved" && "Saved"}
        {saved === "error" && <span className="overdue">Couldn’t save. Check your connection.</span>}
      </p>
    </>
  );
}

function StepsCard({ p, id, gemini, setSteps, setGuide }: {
  p: Progress; id: string; gemini: boolean;
  setSteps: (s: Step[]) => void; setGuide: (g: Progress["guide"]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState("");
  const total = p.steps.reduce((n, s) => n + s.hours, 0);
  const left = p.steps.filter((s) => !s.done).reduce((n, s) => n + s.hours, 0);

  const generate = async () => {
    if (p.steps.some((s) => s.done) && !confirm("Replace your current steps with a new breakdown?")) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/ai/breakdown/${id}`, { method: "POST" });
      if (!res.ok) throw new Error();
      const b = (await res.json()) as Breakdown;
      setSteps(b.steps.map((s) => ({ id: crypto.randomUUID(), title: s.title, hours: s.hours, done: false })));
      setGuide(b.approach || b.watchOuts.length ? { approach: b.approach, watchOuts: b.watchOuts } : null);
    } catch {
      setErr("Couldn’t build a plan right now. Try again.");
    }
    setBusy(false);
  };

  const addStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSteps([...p.steps, { id: crypto.randomUUID(), title: draft.trim(), hours: 1, done: false }]);
    setDraft("");
  };

  return (
    <div className="card steps-card">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Plan {p.steps.length > 0 && <span className="muted small">· {fmtH(left)} left of {fmtH(total)}</span>}</h2>
        <button type="button" className={p.steps.length ? "" : "primary"} onClick={generate} disabled={busy}>
          {busy ? "Thinking…" : p.steps.length ? (gemini ? "✦ Redo with Gemini" : "Redo") : gemini ? "✦ Break it down with Gemini" : "Break it down"}
        </button>
      </div>
      {err && <p className="small overdue">{err}</p>}
      {busy && <p className="muted shimmer small">Reading the instructions and sizing each step…</p>}
      {p.guide && (
        <div className="guide">
          {p.guide.approach && <p style={{ margin: 0 }}>{p.guide.approach}</p>}
          {p.guide.watchOuts.length > 0 && (
            <ul>{p.guide.watchOuts.map((w) => <li key={w}><strong>Watch out:</strong> {w}</li>)}</ul>
          )}
        </div>
      )}
      {p.steps.length === 0 && !busy && (
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          Split this assignment into steps with time estimates. Your week plan and reminder emails use them.
        </p>
      )}
      <ol className="steps">
        {p.steps.map((s, i) => (
          <li key={s.id} className={s.done ? "done" : ""}>
            <input type="checkbox" checked={s.done} aria-label={`Done: ${s.title}`}
              onChange={() => setSteps(p.steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} />
            <input className="step-title" value={s.title} aria-label={`Step ${i + 1}`}
              onChange={(e) => setSteps(p.steps.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))} />
            <input className="step-hours" type="number" min={0} max={40} step={0.25} value={s.hours} aria-label="Hours"
              onChange={(e) => setSteps(p.steps.map((x) => (x.id === s.id ? { ...x, hours: Number(e.target.value) } : x)))} />
            <span className="muted small">h</span>
            <button type="button" className="link small" aria-label="Remove step" onClick={() => setSteps(p.steps.filter((x) => x.id !== s.id))}>✕</button>
          </li>
        ))}
      </ol>
      <form onSubmit={addStep} className="add-step">
        <input placeholder="Add a step" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button>Add</button>
      </form>
    </div>
  );
}

function ResourceFinder({ id, gemini, have, onAdd }: { id: string; gemini: boolean; have: string[]; onAdd: (s: Suggestion) => void }) {
  const [list, setList] = useState<{ concepts: string[]; items: Suggestion[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const res = await fetch(`/api/ai/resources/${id}`, { method: "POST" });
    setList(res.ok ? await res.json() : { concepts: [], items: [] });
    setBusy(false);
  };
  if (!list) {
    return (
      <button type="button" style={{ marginTop: 12 }} onClick={run} disabled={busy}>
        {busy ? "Finding…" : gemini ? "✦ Find resources with Gemini" : "Find resources"}
      </button>
    );
  }
  return (
    <div className="suggest">
      {list.concepts.length > 0 && (
        <p className="small" style={{ margin: "0 0 6px" }}>
          <span className="muted">Key concepts:</span> {list.concepts.join(" · ")}
        </p>
      )}
      {list.items.length === 0 && <p className="muted small">No suggestions right now.</p>}
      {list.items.map((s) => (
        <div key={s.url} className="res">
          <div>
            <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
            <div className="muted small">{s.note}</div>
          </div>
          {have.includes(s.url)
            ? <span className="muted small">Added</span>
            : <button type="button" className="small" onClick={() => onAdd(s)}>Add</button>}
        </div>
      ))}
    </div>
  );
}

function AskCard({ id, gemini }: { id: string; gemini: boolean }) {
  const [q, setQ] = useState("");
  const [thread, setThread] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  if (!gemini) return null;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setQ("");
    const res = await fetch(`/api/ai/ask/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
    const body = await res.json().catch(() => ({}));
    setThread((t) => [...t, { q: question, a: body.answer ?? body.error ?? "Something went wrong." }]);
    setBusy(false);
  };
  return (
    <div className="card">
      <h2>✦ Ask about this assignment</h2>
      {thread.map((t, i) => (
        <div key={i} className="qa">
          <p className="q">{t.q}</p>
          <p className="a">{t.a}</p>
        </div>
      ))}
      {busy && <p className="muted shimmer small">Checking the instructions…</p>}
      <form onSubmit={send} className="add-step">
        <input placeholder="e.g. What citation style do they want? What does question 2 mean?" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" disabled={busy}>Ask</button>
      </form>
    </div>
  );
}
