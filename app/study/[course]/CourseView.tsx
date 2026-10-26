"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Crumbs, Prop } from "@/components/Doc";
import { SourceCard, useHoverCard, type Quote } from "@/components/SourceCard";
import { formatDay, formatDue } from "@/lib/format";
import { clock } from "@/lib/lectures";
import { serial } from "@/lib/serial";
import { CONCEPT_STATUS, studyHref, type Concept, type ConceptStatus, type CourseStudy } from "@/lib/study";

export type ConceptQuote = Quote;

interface ClassRow {
  id: string;
  title: string;
  createdAt: string;
  duration: number;
  preview: string;
}

interface WorkRow {
  id: string;
  name: string;
  dueAt: string | null;
  open: boolean;
}

const due = (w: WorkRow) => (w.dueAt ? new Date(w.dueAt).getTime() : Infinity);

export default function CourseView({ code, name, color, gemini, initial, quotes, lectures, work }: {
  code: string;
  name: string;
  color: string;
  gemini: boolean;
  initial: CourseStudy;
  quotes: Record<string, ConceptQuote[]>; // transcript lines behind each concept, by concept id
  lectures: ClassRow[];
  work: WorkRow[];
}) {
  const router = useRouter();
  const [study, setStudy] = useState(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [adding, setAdding] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [queue] = useState(serial);
  const { hover, bind, keep, hide } = useHoverCard<{ id: string; text: string }>();

  const byId = new Map(work.map((w) => [w.id, w]));
  const classById = new Map(lectures.map((l) => [l.id, l]));
  const concepts = [...study.concepts].sort((a, b) => Number(a.status === "understood") - Number(b.status === "understood"));
  const understood = concepts.filter((c) => c.status === "understood").length;
  const upcoming = work.filter((w) => w.open).sort((a, b) => due(a) - due(b));
  const next = upcoming.find((w) => w.dueAt);

  // Links from Today, the planner and class notes point at one concept: open it.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!study.concepts.some((c) => c.id === id)) return;
    setExpanded(new Set([id]));
    setFlash(id);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center" }));
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (body: { status?: Record<string, ConceptStatus>; add?: string; remove?: string }) =>
    queue(async () => {
      const res = await fetch(`/api/study/${encodeURIComponent(code)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) return setErr("Couldn't save that. Try again.");
      setStudy(await res.json());
    });

  const setStatus = (id: string, status: ConceptStatus) => {
    setStudy((s) => ({ ...s, concepts: s.concepts.map((c) => (c.id === id ? { ...c, status } : c)) }));
    void save({ status: { [id]: status } });
  };

  const build = async () => {
    setBuilding(true);
    setErr("");
    await queue(async () => undefined); // let any save still on its way land first
    const res = await fetch(`/api/study/${encodeURIComponent(code)}/concepts`, { method: "POST" });
    setBuilding(false);
    if (!res.ok) return setErr("Couldn't update the concepts. Try again.");
    setStudy(await res.json());
    router.refresh(); // fresh transcript quotes for the new concepts
  };

  const newClass = async () => {
    setCreating(true);
    const title = `Class on ${formatDay(new Date().toISOString()).replace(/^\w+, /, "")}`;
    const res = await fetch("/api/lectures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseCode: code, title }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return (setCreating(false), setErr(body.error ?? "Couldn't start a class."));
    router.push(studyHref(code, body.id));
  };

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (c: Concept) => {
    const open = expanded.has(c.id);
    const needs = c.assignments.map((id) => byId.get(id)).filter((w): w is WorkRow => !!w).sort((a, b) => due(a) - due(b));
    const soonest = needs.find((w) => w.open);
    const taught = c.sources.flatMap((s) => {
      const l = classById.get(s.lectureId);
      if (!l) return [];
      const q = (quotes[c.id] ?? []).find((x) => x.key.startsWith(`${s.lectureId}:`));
      return [{ id: l.id, title: l.title, time: q?.time, href: q?.href ?? studyHref(code, l.id) }];
    });
    return (
      <div key={c.id} id={c.id} className={`concept ${open ? "open" : ""} ${flash === c.id ? "flash" : ""}`}>
        <div className="concept-row">
          <button type="button" className="caret" onClick={() => toggle(c.id)} aria-expanded={open} aria-label={open ? `Hide ${c.name}` : `Show ${c.name}`}>▸</button>
          <button type="button" className="concept-name" onClick={() => toggle(c.id)}>{c.name}</button>
          {soonest && <span className="concept-need">{soonest.name}{soonest.dueAt ? ` · ${formatDay(soonest.dueAt)}` : ""}</span>}
          <select className={`pill-select cs-${c.status}`} value={c.status} onChange={(e) => setStatus(c.id, e.target.value as ConceptStatus)} aria-label={`How well you understand ${c.name}`}>
            {(Object.keys(CONCEPT_STATUS) as ConceptStatus[]).map((s) => <option key={s} value={s}>{CONCEPT_STATUS[s]}</option>)}
          </select>
        </div>
        {open && (
          <div className="concept-body">
            {c.explanation ? (
              <p>
                <span {...bind(c.id, { id: c.id, text: c.explanation })} className={`src ${hover?.key === c.id ? "on" : ""}`}>{c.explanation}</span>
              </p>
            ) : (
              <p className="faint">Not covered in your class notes yet.{needs.length ? " Your assignments need it, so look for it in the readings or ask in office hours." : ""}</p>
            )}
            {(taught.length > 0 || needs.length > 0) && (
              <div className="mini-props">
                {taught.length > 0 && (
                  <div>
                    <span className="mini-k">Taught in</span>
                    <span className="mini-v">
                      {taught.map((t) => <Link key={t.id} href={t.href} className="chip-link">📄 {t.title}{t.time ? ` · ${t.time}` : ""}</Link>)}
                    </span>
                  </div>
                )}
                {needs.length > 0 && (
                  <div>
                    <span className="mini-k">Needed for</span>
                    <span className="mini-v">
                      {needs.map((w) => <Link key={w.id} href={`/a/${w.id}`} className={`chip-link ${w.open ? "" : "faint"}`}>📌 {w.name}{w.dueAt ? ` · ${formatDay(w.dueAt)}` : ""}</Link>)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {c.questions.length > 0 && (
              <>
                <div className="mini-h">Check your understanding</div>
                <ol className="checks">{c.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
              </>
            )}
            <div className="concept-actions">
              <Link href={`/performance?course=${encodeURIComponent(code)}&topic=${encodeURIComponent(c.name)}`}>Quiz me on this</Link>
              <button type="button" className="inline-link faint" onClick={() => save({ remove: c.id })}>Remove</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <article className="doc">
      <div className="doc-top">
        <Crumbs trail={[{ label: "Study", href: "/study" }, { label: code }]} />
        <div className="doc-actions">
          <button type="button" className="ghost" onClick={newClass} disabled={creating}><span className="rec-dot small" /> {creating ? "Opening…" : "Record a class"}</button>
        </div>
      </div>

      <div className="doc-icon course-icon" style={{ ["--c" as string]: color }} aria-hidden>{code.replace(/[^A-Za-z]/g, "").slice(0, 3)}</div>
      <h1 className="doc-title">{code}</h1>
      {name && <p className="doc-sub">{name}</p>}

      <div className="props">
        <Prop icon="◎" label="Understood">
          <span className="bar" aria-hidden><i style={{ width: `${concepts.length ? (understood / concepts.length) * 100 : 0}%` }} /></span>
          {concepts.length ? `${understood} of ${concepts.length} concepts` : <span className="faint">No concepts yet</span>}
        </Prop>
        <Prop icon="▤" label="Class notes">{lectures.length ? `${lectures.length} class${lectures.length === 1 ? "" : "es"}` : <span className="faint">None yet</span>}</Prop>
        <Prop icon="⚑" label="Next due">{next ? <><Link href={`/a/${next.id}`}>{next.name}</Link> <span className="faint">· {formatDue(next.dueAt)}</span></> : <span className="faint">Nothing due</span>}</Prop>
      </div>

      {err && <div className="callout warn"><span className="callout-ico" aria-hidden>⚠️</span><div>{err}</div></div>}

      <div className="h2-row">
        <h2>Concepts to understand</h2>
        {(gemini || concepts.length > 0) && (
          <button type="button" className="ghost" onClick={build} disabled={building}>{building ? "Reading your notes…" : gemini ? "✦ Update from notes" : "Update from notes"}</button>
        )}
      </div>
      {concepts.length === 0 ? (
        <div className="callout">
          <span className="callout-ico" aria-hidden>🧭</span>
          <div>
            <strong>Find the ideas this course&apos;s work depends on</strong>
            {gemini ? (
              <>
                <p>
                  {lectures.length
                    ? "Pace reads your class notes and open assignments and lists the concepts to understand, each linked to the class where it was taught."
                    : "Record a class first, or find them now from what your open assignments need."}
                </p>
                <button type="button" className="doc-btn" onClick={build} disabled={building}>{building ? "Reading your notes…" : "Find concepts"}</button>
              </>
            ) : (
              <p>Add the concepts you want to understand below. Pace finds where each one came up in your classes and which assignments mention it.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="concepts">{concepts.map(row)}</div>
      )}
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          // Refresh too, for the transcript lines behind the new concept.
          if (adding.trim()) void save({ add: adding.trim() }).then(() => (setAdding(""), router.refresh()));
        }}
      >
        <span aria-hidden>+</span>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a concept you want to understand" aria-label="Add a concept" />
      </form>

      <h2>Class notes</h2>
      <div className="db-list">
        {lectures.map((l) => (
          <Link key={l.id} href={studyHref(code, l.id)} className="db-row">
            <span className="db-ico" aria-hidden>📄</span>
            <span className="db-main">
              <span className="db-title">{l.title}</span>
              <span className="db-preview">{l.preview}</span>
            </span>
            <span className="db-meta">{formatDay(l.createdAt)}{l.duration ? ` · ${clock(l.duration)}` : ""}</span>
          </Link>
        ))}
        <button type="button" className="db-new" onClick={newClass} disabled={creating}>+ New class</button>
      </div>

      {upcoming.length > 0 && (
        <>
          <h2>Coming up</h2>
          <div className="db-list">
            {upcoming.slice(0, 8).map((w) => {
              const needs = study.concepts.filter((c) => c.assignments.includes(w.id));
              const ok = needs.filter((c) => c.status === "understood").length;
              return (
                <Link key={w.id} href={`/a/${w.id}`} className="db-row">
                  <span className="db-ico" aria-hidden>📌</span>
                  <span className="db-main">
                    <span className="db-title">{w.name}</span>
                    <span className="db-preview">
                      {needs.length ? `${ok} of ${needs.length} concept${needs.length === 1 ? "" : "s"} understood: ${needs.map((c) => c.name).join(", ")}` : "No concepts linked yet"}
                    </span>
                  </span>
                  <span className="db-meta">{w.dueAt ? formatDay(w.dueAt) : "No due date"}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <p className="doc-foot">
        {study.ai ? "Concepts found by Gemini from your class notes and open assignments. " : "Each concept links to the classes that mention it. "}
        Hover an explanation to see the words it came from.
      </p>

      {hover && (
        <SourceCard hover={hover} note={hover.data.text} quotes={quotes[hover.data.id] ?? []} onEnter={keep} onLeave={hide} />
      )}
    </article>
  );
}
