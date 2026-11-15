"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  deadlineInfo, formatDay, isInFlight, isToApply, KIND_LABEL, nextStep, OPP_KINDS, PIPELINE, planProgress, sortRelevance, STATUS_LABEL,
  type Opportunity, type OppStatus,
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
  const listed = items.filter((o) => o.status !== "suggested");

  return (
    <>
      <Inbox items={inbox} today={today} gemini={gemini} patch={patch} />

      <AddOpportunity gemini={gemini} />

      <RolesTable items={listed} today={today} patch={patch} />
    </>
  );
}

type Filter = "all" | "open" | "applied" | "closed";
type SortKey = "deadline" | "fit" | "role";

const FILTERS: { key: Filter; label: string; test: (o: Opportunity) => boolean }[] = [
  { key: "all", label: "All", test: (o) => o.status !== "closed" },
  { key: "open", label: "Not applied", test: isToApply },
  { key: "applied", label: "Applied", test: isInFlight },
  { key: "closed", label: "Closed", test: (o) => o.status === "closed" },
];

const byDeadline = (a: Opportunity, b: Opportunity) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
const SORTS: Record<SortKey, (a: Opportunity, b: Opportunity) => number> = {
  deadline: (a, b) => byDeadline(a, b) || b.relevance - a.relevance,
  fit: (a, b) => b.relevance - a.relevance || byDeadline(a, b),
  role: (a, b) => a.title.localeCompare(b.title) || a.organization.localeCompare(b.organization),
};

function RolesTable({ items, today, patch }: { items: Opportunity[]; today: string; patch: (id: string, b: Partial<Opportunity>) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("deadline");
  const [starredFirst, setStarredFirst] = useState(true);
  const [q, setQ] = useState("");

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (o: Opportunity) => {
    const hay = `${o.title} ${o.organization} ${o.location} ${KIND_LABEL[o.kind]}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const test = FILTERS.find((f) => f.key === filter)!.test;
  const rows = items
    .filter((o) => test(o) && matches(o))
    .sort((a, b) => (starredFirst ? Number(b.priority) - Number(a.priority) : 0) || SORTS[sort](a, b));

  const toggleApplied = (o: Opportunity) =>
    patch(o.id, { status: isInFlight(o) ? (o.plan ? "preparing" : "saved") : "applied" });

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={className} aria-sort={sort === k ? (k === "fit" ? "descending" : "ascending") : undefined}>
      <button type="button" className={`th-sort ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>
        {children}{sort === k && <span aria-hidden> {k === "fit" ? "↓" : "↑"}</span>}
      </button>
    </th>
  );

  return (
    <section className="roles">
      <div className="section-title">Roles <span className="count">{items.filter((o) => o.status !== "closed").length}</span></div>
      <div className="roles-bar">
        <input type="search" className="roles-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by role, company or city" aria-label="Search roles" />
        <div className="seg" role="tablist" aria-label="Filter roles">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label} <span className="seg-n">{items.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <label className="small muted roles-pin">
          <input type="checkbox" checked={starredFirst} onChange={(e) => setStarredFirst(e.target.checked)} /> Starred first
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="empty">{items.length === 0 ? "Add an opportunity above, or accept one the Scout found." : "No roles match. Try another filter or search."}</p>
      ) : (
        <div className="roles-wrap">
          <table className="roles-table">
            <thead>
              <tr>
                <th className="c-star"><span className="sr-only">Priority</span></th>
                <Th k="role">Role</Th>
                <Th k="deadline" className="c-due">Deadline</Th>
                <Th k="fit" className="c-fit">Fit</Th>
                <th className="c-status">Status</th>
                <th className="c-applied">Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => <RoleRow key={o.id} o={o} today={today} patch={patch} toggleApplied={toggleApplied} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RoleRow({ o, today, patch, toggleApplied }: { o: Opportunity; today: string; patch: (id: string, b: Partial<Opportunity>) => void; toggleApplied: (o: Opportunity) => void }) {
  const d = deadlineInfo(o.deadline, today);
  const applied = isInFlight(o);
  const step = nextStep(o);
  const pct = planProgress(o);
  return (
    <tr className={`${applied ? "is-applied" : ""} ${o.status === "closed" ? "is-closed" : ""}`}>
      <td className="c-star">
        <button type="button" className={`star ${o.priority ? "on" : ""}`} aria-pressed={o.priority} title={o.priority ? "Remove from priority" : "Mark as priority"} onClick={() => patch(o.id, { priority: !o.priority })}>
          {o.priority ? "★" : "☆"}
        </button>
      </td>
      <td className="c-role">
        <Link href={`/careers/${o.id}`} className="opp-title">{o.title}</Link>
        <div className="muted small">{[o.organization, o.location].filter(Boolean).join(" · ")}</div>
        <div className="role-meta small">
          <span className="chip">{KIND_LABEL[o.kind]}</span>
          {o.url && <a href={o.url} target="_blank" rel="noreferrer">Posting ↗</a>}
          {o.plan ? (
            <span className="muted">{step ? <>Next: {step.title} ({pct}%)</> : "Plan done"}</span>
          ) : (
            isToApply(o) && <Link href={`/careers/${o.id}`}>✦ Plan</Link>
          )}
        </div>
      </td>
      <td className={`c-due u-${applied ? "none" : d.urgency}`} data-label="Deadline">
        <span className="due-day">{o.deadline ? formatDay(o.deadline, true) : "No deadline"}</span>
        <span className="due-left small">{applied && o.appliedAt ? `Applied ${formatDay(o.appliedAt.slice(0, 10))}` : d.label}</span>
      </td>
      <td className="c-fit" data-label="Fit"><Fit n={o.relevance} /></td>
      <td className="c-status" data-label="Status">
        <select value={o.status} aria-label={`Status for ${o.title}`} className={`status-select st-${o.status}`} onChange={(e) => patch(o.id, { status: e.target.value as OppStatus })}>
          {PIPELINE.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </td>
      <td className="c-applied" data-label="Applied">
        <button type="button" role="switch" aria-checked={applied} aria-label={applied ? `Mark ${o.title} as not applied` : `Mark ${o.title} as applied`} className={`switch ${applied ? "on" : ""}`} onClick={() => toggleApplied(o)} disabled={o.status === "closed"}>
          <span className="knob" />
        </button>
        <span className="switch-label small">{applied ? "Yes" : "No"}</span>
      </td>
    </tr>
  );
}

const Fit = ({ n }: { n: number }) => <span className={`fit ${n >= 80 ? "hi" : n >= 60 ? "mid" : "lo"}`}>{n}% fit</span>;

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
