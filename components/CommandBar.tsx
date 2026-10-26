"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const EXAMPLES = [
  "I work Tuesday 5 to 10pm and have nothing planned Sunday",
  "Midterm in CSC263 next Wednesday on heaps, AVL trees and hashing",
  "Quiz me on titration error analysis",
  "Open my lab report",
];

export default function CommandBar({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ agent: string; message: string; href?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => input.current?.focus(), []);

  const run = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setRes(null);
    const r = await fetch("/api/agents/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: q }) });
    const body = await r.json().catch(() => ({ agent: "Pace", message: "Something went wrong." }));
    setBusy(false);
    setRes(body.error ? { agent: "Pace", message: body.error } : body);
    if (body.href) {
      router.push(body.href);
      router.refresh();
    }
  };

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd" role="dialog" aria-label="Ask Pace" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={(e) => { e.preventDefault(); run(text); }}>
          <span className="spark" style={{ fontSize: 20 }}>✦</span>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell Pace what's going on…" />
          <button className="primary" disabled={busy}>{busy ? "…" : "Go"}</button>
        </form>
        {busy && <div className="result"><p className="muted shimmer" style={{ margin: 0 }}>Picking the right agent…</p></div>}
        {res && (
          <div className="result">
            <span className="agent-tag">✦ {res.agent} agent</span>
            <p style={{ margin: 0 }}>{res.message}</p>
            {res.href && <p className="muted small" style={{ margin: 0 }}>Opened it for you. Press Esc to close.</p>}
          </div>
        )}
        {!busy && !res && (
          <div className="hint">
            <span className="muted small" style={{ padding: "0 10px" }}>Try</span>
            {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => { setText(e); run(e); }}>{e}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
