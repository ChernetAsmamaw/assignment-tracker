"use client";

import { useEffect, useRef, useState } from "react";
import { STATUS_LABEL, type Kind, type Progress, type Resource, type Status } from "@/lib/types";

export default function Editor({ id, initial, quercusGroup }: { id: string; initial: Progress; quercusGroup: boolean }) {
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

  return (
    <>
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
        <label htmlFor="pct">{p.percent}% complete</label>
        <input
          id="pct" type="range" min={0} max={100} step={5} value={p.percent}
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
        <form className="res-form" onSubmit={addResource}>
          <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="Link (optional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <input className="full" placeholder="Note, e.g. page numbers or how you used it" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <div className="full"><button className="primary">Add resource</button></div>
        </form>
      </div>

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
