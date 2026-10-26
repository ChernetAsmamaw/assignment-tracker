"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  deadlineInfo, formatDay, isInFlight, isToApply, KIND_LABEL, nextStep, OPP_KINDS, planProgress, sortPriority, sortRelevance, STATUS_LABEL,
  type Opportunity,
} from "@/lib/careers";

const put = (id: string, body: Partial<Opportunity>) =>
  fetch(`/api/careers/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export default function CareerBoard({ items: initial, today, gemini }: { items: Opportunity[]; today: string; gemini: boolean }) {
  const [items, setItems] = useState(initial);
  const router = useRouter();
  useEffect(() => setItems(initial), [initial]);

  const patch = async (id: string, body: Partial<Opportunity>) => {
    setItems((cur) => cur.map((o) => (o.id === id ? { ...o, ...body } : o)).filter((o) => o.status !== "dismissed"));
    await put(id, body);
    router.refresh();
  };

  const inbox = sortRelevance(items.filter((o) => o.status === "suggested"));
  const toApply = items.filter(isToApply);
  const priority = sortPriority(toApply.filter((o) => o.priority));
  const rest = sortRelevance(toApply.filter((o) => !o.priority));
  const applied = sortPriority(items.filter(isInFlight));
  const closed = items.filter((o) => o.status === "closed");

  return (
    <>
      <Inbox items={inbox} today={today} gemini={gemini} patch={patch} />

      <AddOpportunity gemini={gemini} />

      <div className="section-title"><span className="star-ico">★</span> Priority <span className="count">{priority.length}</span></div>
      <p className="muted small" style={{ margin: "-6px 0 12px" }}>The ones you&apos;ve decided to go after, soonest deadline first. Star an opportunity to move it here.</p>
      {priority.length === 0 && <p className="empty">Nothing starred yet. Star the applications you want to focus on.</p>}
      <div className="opp-list">{priority.map((o) => <Row key={o.id} o={o} today={today} patch={patch} />)}</div>

      <div className="section-title">◎ By relevance <span className="count">{rest.length}</span></div>
      <p className="muted small" style={{ margin: "-6px 0 12px" }}>Everything else on your list, ranked by how well it fits your background and location.</p>
      {rest.length === 0 && <p className="empty">Add an opportunity above, or accept one the Scout found.</p>}
      <div className="opp-list">{rest.map((o) => <Row key={o.id} o={o} today={today} patch={patch} />)}</div>

      {applied.length > 0 && (
        <>
          <div className="section-title">Applied <span className="count">{applied.length}</span></div>
          <div className="opp-list">{applied.map((o) => <Row key={o.id} o={o} today={today} patch={patch} />)}</div>
        </>
      )}

      {closed.length > 0 && (
        <details className="done-block" style={{ marginTop: 24 }}>
          <summary className="muted small"> Closed ({closed.length})</summary>
          <div className="opp-list" style={{ marginTop: 10 }}>{closed.map((o) => <Row key={o.id} o={o} today={today} patch={patch} />)}</div>
        </details>
      )}
    </>
  );
}

function Due({ o, today }: { o: Opportunity; today: string }) {
  const d = deadlineInfo(o.deadline, today);
  return (
    <div className={`opp-due u-${d.urgency}`}>
      {d.days != null && d.days >= 0 ? (
        <>
          <span className="cd-value">{d.days}</span>
          <span className="cd-label">{d.days === 1 ? "day left" : "days left"}</span>
        </>
      ) : (
        <span className="cd-label">{d.days == null ? "Rolling" : "Closed"}</span>
      )}
      <span className="small">{o.deadline ? formatDay(o.deadline) : "No deadline"}</span>
    </div>
  );
}

const Fit = ({ n }: { n: number }) => <span className={`fit ${n >= 80 ? "hi" : n >= 60 ? "mid" : "lo"}`}>{n}% fit</span>;

function Row({ o, today, patch }: { o: Opportunity; today: string; patch: (id: string, b: Partial<Opportunity>) => void }) {
  const step = nextStep(o);
  const pct = planProgress(o);
  return (
    <div className="opp-row">
      <button type="button" className={`star ${o.priority ? "on" : ""}`} aria-pressed={o.priority} title={o.priority ? "Remove from priority" : "Mark as priority"} onClick={() => patch(o.id, { priority: !o.priority })}>
        {o.priority ? "★" : "☆"}
      </button>
      <div className="opp-main">
        <div className="tags">
          <span className="chip">{KIND_LABEL[o.kind]}</span>
          <Fit n={o.relevance} />
          <span className={`pill st-${o.status}`}>{STATUS_LABEL[o.status]}</span>
        </div>
        <Link href={`/careers/${o.id}`} className="opp-title">{o.title}</Link>
        <div className="muted small">{[o.organization, o.location, o.startDate && `Starts ${o.startDate}`].filter(Boolean).join(" · ")}</div>
        {o.whyRelevant && <div className="small why">{o.whyRelevant}</div>}
        {o.plan ? (
          <div className="next-step">
            <div className="meter"><span style={{ width: `${pct}%` }} /></div>
            <span className="small">{step ? <>Next: <strong>{step.title}</strong> · {step.due <= today ? <span className="overdue">{step.due < today ? "overdue" : "today"}</span> : formatDay(step.due)}</> : "Every step done"}</span>
          </div>
        ) : (
          isToApply(o) && <Link href={`/careers/${o.id}`} className="small">✦ Get an application plan →</Link>
        )}
      </div>
      <Due o={o} today={today} />
    </div>
  );
}

function Inbox({ items, today, gemini, patch }: { items: Opportunity[]; today: string; gemini: boolean; patch: (id: string, b: Partial<Opportunity>) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const router = useRouter();
  const search = async () => {
    setBusy(true);
    setNote("");
    const res = await fetch("/api/careers/scout", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setNote(body.note ?? body.error ?? "Something went wrong.");
    router.refresh();
  };
  return (
    <div className="card coach inbox">
      <div className="row-between">
        <span className="ai-badge">{gemini ? "✦ Scout agent · Gemini + Google Search" : "Scout agent"}</span>
        <button type="button" onClick={search} disabled={busy || !gemini}>{busy ? "Searching the web…" : "Search now"}</button>
      </div>
      <h2 className="coach-title">
        {items.length ? `${items.length} new ${items.length === 1 ? "opportunity" : "opportunities"} to review` : "No new finds to review"}
      </h2>
      <p className="muted small" style={{ margin: "0 0 10px" }}>
        {gemini
          ? "Every morning the Scout searches for internships, practicums and conferences that match your profile, and checks the career sites you follow. Add the ones you want."
          : "Add GEMINI_API_KEY to let the Scout search the web for you every morning."}
        {note && <> <strong>{note}</strong></>}
      </p>
      <div className="sugs">
        {items.map((o) => {
          const d = deadlineInfo(o.deadline, today);
          return (
            <div key={o.id} className="sug">
              <div className="tags">
                <span className="chip">{KIND_LABEL[o.kind]}</span>
                <Fit n={o.relevance} />
                <span className={`small u-${d.urgency} tone-text`}>{o.deadline ? `${formatDay(o.deadline)} · ${d.label}` : d.label}</span>
              </div>
              <Link href={`/careers/${o.id}`} className="opp-title">{o.title}</Link>
              <div className="muted small">{[o.organization, o.location].filter(Boolean).join(" · ")}</div>
              {o.whyRelevant && <p className="small why">{o.whyRelevant}</p>}
              <div className="sug-actions">
                <button type="button" className="primary" onClick={() => patch(o.id, { status: "saved" })}>Add to list</button>
                <button type="button" onClick={() => patch(o.id, { status: "saved", priority: true })}>★ Add as priority</button>
                <Link href={`/careers/${o.id}`} className="small">Review</Link>
                <button type="button" className="link small" onClick={() => patch(o.id, { status: "dismissed" })}>Not for me</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddOpportunity({ gemini }: { gemini: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", organization: "", url: "", deadline: "", location: "", kind: "", posting: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/careers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && body.id) return router.push(`/careers/${body.id}`);
    if (!res.ok) return setErr(body.error ?? "Something went wrong.");
    router.push(`/careers/${body.id}`);
    router.refresh();
  };
  if (!open) return <button type="button" className="add-opp" onClick={() => setOpen(true)}>+ Add an opportunity you found</button>;
  return (
    <form className="card form-grid" onSubmit={submit}>
      <label>Position<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Software Engineering Intern" /></label>
      <label>Organization<input value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} placeholder="GFT Technologies" /></label>
      <label>Link to posting<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://jobs.gft.com/…" /></label>
      <label>Deadline<input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></label>
      <label>Location<input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Toronto, ON (hybrid)" /></label>
      <label>Type
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="">{gemini ? "Work it out from the posting" : "Internship"}</option>
          {OPP_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="full">Paste the posting {gemini && <span className="muted">(optional: Gemini fills in the rest, lists the requirements and scores the fit)</span>}
        <textarea style={{ minHeight: 100 }} value={f.posting} onChange={(e) => setF({ ...f, posting: e.target.value })} placeholder="Copy the job description here" />
      </label>
      <div className="full row-between">
        <span>
          <button className="primary" disabled={busy}>{busy ? "Reading the posting…" : "Add to my list"}</button>
          {err && <span className="small overdue" style={{ marginLeft: 10 }}>{err}</span>}
        </span>
        <button type="button" className="link small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
