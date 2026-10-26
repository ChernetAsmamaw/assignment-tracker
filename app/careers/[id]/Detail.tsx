"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDay, newId, PIPELINE, planProgress, STATUS_LABEL, type Opportunity, type PlanStep } from "@/lib/careers";

type Tone = "warm" | "formal" | "concise";

export default function Detail({ initial, today, gemini, profileReady }: { initial: Opportunity; today: string; gemini: boolean; profileReady: boolean }) {
  const [o, setO] = useState(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const skip = useRef(true);
  const lastDeadline = useRef(initial.deadline);
  const router = useRouter();

  // Autosave shortly after each edit; whole-object replies from the agents skip one round.
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    setSaved("saving");
    const t = setTimeout(async () => {
      const res = await fetch(`/api/careers/${o.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: o.status, priority: o.priority, deadline: o.deadline, url: o.url, location: o.location, startDate: o.startDate,
          notes: o.notes, coverLetter: o.coverLetter, links: o.links, plan: o.plan ? { steps: o.plan.steps } : undefined,
        }),
      });
      setSaved(res.ok ? "saved" : "error");
      if (o.deadline !== lastDeadline.current) {
        lastDeadline.current = o.deadline;
        router.refresh();
      }
    }, 600);
    return () => clearTimeout(t);
  }, [o, router]);

  const update = (patch: Partial<Opportunity>) => setO((cur) => ({ ...cur, ...patch }));
  const replace = (next: Opportunity) => { skip.current = true; setO(next); };

  const review = async (patch: Partial<Opportunity>) => {
    update(patch);
    if (patch.status === "dismissed") {
      await fetch(`/api/careers/${o.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      router.push("/careers");
      router.refresh();
    }
  };

  const remove = async () => {
    if (!confirm("Delete this opportunity?")) return;
    await fetch(`/api/careers/${o.id}`, { method: "DELETE" });
    router.push("/careers");
    router.refresh();
  };

  return (
    <>
      {o.status === "suggested" && (
        <div className="card coach review">
          <span className="ai-badge">✦ Scout found this for you</span>
          <h2 className="coach-title">Add it to your list?</h2>
          <p className="muted small" style={{ margin: "0 0 10px" }}>Check the posting, then add it. You can build a plan and a cover letter either way.</p>
          <div className="sug-actions">
            <button type="button" className="primary" onClick={() => review({ status: "saved" })}>Add to list</button>
            <button type="button" onClick={() => review({ status: "saved", priority: true })}>★ Add as priority</button>
            <button type="button" className="link small" onClick={() => review({ status: "dismissed" })}>Not for me</button>
          </div>
        </div>
      )}

      {!profileReady && (
        <div className="banner">Your profile is empty, so fit scores, plans and letters are generic. <Link href="/careers/profile">Add your background</Link>.</div>
      )}

      <div className="two-col">
        <div>
          <About o={o} />
          <PlanCard o={o} today={today} gemini={gemini} replace={replace} setSteps={(steps) => update({ plan: o.plan ? { ...o.plan, steps } : null })} />
          <LetterCard o={o} gemini={gemini} setLetter={(coverLetter) => update({ coverLetter })} replaceLetter={(coverLetter) => { skip.current = true; setO((cur) => ({ ...cur, coverLetter })); }} />
        </div>

        <div>
          <div className="card">
            <h2>Where you are</h2>
            <div className="seg pipeline">
              {PIPELINE.map((s) => (
                <button key={s} type="button" aria-pressed={o.status === s} onClick={() => update({ status: s, appliedAt: s === "applied" && !o.appliedAt ? new Date().toISOString() : o.appliedAt })}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <button type="button" className={`star-toggle ${o.priority ? "on" : ""}`} aria-pressed={o.priority} onClick={() => update({ priority: !o.priority })}>
              {o.priority ? "★ Priority" : "☆ Mark as priority"}
            </button>
            {o.appliedAt && <p className="muted small" style={{ margin: "8px 0 0" }}>Applied {formatDay(o.appliedAt.slice(0, 10), true)}</p>}
          </div>

          <div className="card">
            <h2>Details</h2>
            <div className="stack">
              <label>Deadline<input type="date" value={o.deadline ?? ""} onChange={(e) => update({ deadline: e.target.value || null })} /></label>
              <label>Link to posting<input value={o.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://" /></label>
              <label>Location<input value={o.location} onChange={(e) => update({ location: e.target.value })} /></label>
              <label>Start date / length<input value={o.startDate} onChange={(e) => update({ startDate: e.target.value })} placeholder="May to August 2027" /></label>
            </div>
          </div>

          <Links o={o} setLinks={(links) => update({ links })} />

          <div className="card">
            <h2>Notes</h2>
            <textarea value={o.notes} placeholder="Contacts, referral status, interview prep, salary…" onChange={(e) => update({ notes: e.target.value })} />
          </div>

          <p className="small muted row-between">
            <span>
              {saved === "saving" && "Saving…"}
              {saved === "saved" && "Saved"}
              {saved === "error" && <span className="overdue">Couldn’t save. Check your connection.</span>}
            </span>
            <button type="button" className="link small" onClick={remove}>Delete</button>
          </p>
        </div>
      </div>
    </>
  );
}

function About({ o }: { o: Opportunity }) {
  return (
    <div className="card">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <h2>Why it fits you</h2>
        <span className={`fit big ${o.relevance >= 80 ? "hi" : o.relevance >= 60 ? "mid" : "lo"}`}>{o.relevance}% fit</span>
      </div>
      <p style={{ margin: "0 0 12px" }}>{o.whyRelevant || "No fit notes yet. Paste the posting when you add one and Gemini explains the fit."}</p>
      {o.summary && <><h3 className="mini">About the role</h3><p className="small" style={{ margin: "0 0 12px" }}>{o.summary}</p></>}
      {o.requirements.length > 0 && (
        <>
          <h3 className="mini">What they ask for</h3>
          <ul className="tips small">{o.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function PlanCard({ o, today, gemini, replace, setSteps }: { o: Opportunity; today: string; gemini: boolean; replace: (o: Opportunity) => void; setSteps: (s: PlanStep[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const plan = o.plan;
  const build = async () => {
    if (plan && !confirm("Replace this plan with a new one? Checked-off steps will be reset.")) return;
    setBusy(true);
    const res = await fetch(`/api/careers/${o.id}/plan`, { method: "POST" });
    setBusy(false);
    if (res.ok) replace(await res.json());
  };
  const label = gemini ? "✦ Build my application plan" : "Build my application plan";

  return (
    <div className="card coach plan-card-x">
      <div className="row-between">
        <span className="ai-badge">{plan?.ai ? "✦ Application plan · Gemini" : "Application plan"}</span>
        {plan && <span className="muted small">{planProgress(o)}% done</span>}
      </div>
      {!plan && (
        <>
          <h2 className="coach-title">What to do, and in what order</h2>
          <p className="small muted" style={{ margin: "0 0 12px" }}>
            Get a step-by-step plan dated back from the deadline: what to prioritize, which parts of your background to lead with, and what&apos;s easy to miss.
          </p>
          <button type="button" className="primary" onClick={build} disabled={busy}>{busy ? "Planning…" : label}</button>
        </>
      )}
      {plan && (
        <>
          <p style={{ margin: "8px 0 12px" }}>{plan.strategy}</p>
          {plan.focus.length > 0 && (
            <div className="focus">
              <h3 className="mini">Prioritize</h3>
              <ol>{plan.focus.map((f) => <li key={f}>{f}</li>)}</ol>
            </div>
          )}
          <h3 className="mini" style={{ marginTop: 14 }}>Steps</h3>
          <ul className="plan-steps">
            {plan.steps.map((s) => (
              <li key={s.id} className={`${s.done ? "done" : ""} ${!s.done && s.due < today ? "late" : ""}`}>
                <input type="checkbox" checked={s.done} aria-label="Done" onChange={(e) => setSteps(plan.steps.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)))} />
                <div>
                  <strong>{s.title}</strong>
                  {s.detail && <div className="small muted">{s.detail}</div>}
                </div>
                <span className="step-due">
                  <input type="date" value={s.due} aria-label="Due" onChange={(e) => e.target.value && setSteps(plan.steps.map((x) => (x.id === s.id ? { ...x, due: e.target.value } : x)))} />
                  <button type="button" className="link small" aria-label="Remove step" onClick={() => setSteps(plan.steps.filter((x) => x.id !== s.id))}>×</button>
                </span>
              </li>
            ))}
          </ul>
          <form className="add-step" onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setSteps([...plan.steps, { id: newId(), title: draft.trim(), detail: "", due: o.deadline && o.deadline > today ? o.deadline : today, done: false }]);
            setDraft("");
          }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add your own step" />
            <button>Add</button>
          </form>
          {(plan.talkingPoints.length > 0 || plan.watchOuts.length > 0) && (
            <div className="plan-extra">
              {plan.talkingPoints.length > 0 && <div><h3 className="mini">Lead with</h3><ul className="tips small">{plan.talkingPoints.map((t) => <li key={t}>{t}</li>)}</ul></div>}
              {plan.watchOuts.length > 0 && <div><h3 className="mini">Watch out for</h3><ul className="tips small">{plan.watchOuts.map((t) => <li key={t}>{t}</li>)}</ul></div>}
            </div>
          )}
          <p style={{ margin: "12px 0 0" }}><button type="button" className="link small" onClick={build} disabled={busy}>{busy ? "Planning…" : "Rebuild the plan"}</button></p>
        </>
      )}
    </div>
  );
}

function LetterCard({ o, gemini, setLetter, replaceLetter }: { o: Opportunity; gemini: boolean; setLetter: (s: string) => void; replaceLetter: (s: string) => void }) {
  const [tone, setTone] = useState<Tone>("warm");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const generate = async () => {
    if (o.coverLetter && !confirm("Replace your current letter with a new draft?")) return;
    setBusy(true);
    setNote("");
    const res = await fetch(`/api/careers/${o.id}/letter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tone, extra }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNote(body.error ?? "Something went wrong.");
    replaceLetter(body.letter);
    setNote(body.ai ? "Draft ready. Fill in anything in [brackets] and make the opening your own." : "Template ready: fill in the [brackets]. Add GEMINI_API_KEY for a fully written draft.");
  };
  const copy = async () => {
    await navigator.clipboard.writeText(o.coverLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([o.coverLetter], { type: "text/plain" }));
    a.download = `Cover letter - ${o.organization}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="card">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Cover letter</h2>
        {o.coverLetter && (
          <span className="seg">
            <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button type="button" onClick={download}>Download</button>
          </span>
        )}
      </div>
      <p className="small muted" style={{ margin: "6px 0 10px" }}>Written from your profile and resume for this posting. It never makes up experience: gaps show up as [brackets].</p>
      <div className="letter-controls">
        <div className="seg">
          {(["warm", "formal", "concise"] as Tone[]).map((t) => (
            <button key={t} type="button" aria-pressed={tone === t} onClick={() => setTone(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Anything to mention? e.g. my hackathon win, I'm a GFT referral" />
        <button type="button" className="primary" onClick={generate} disabled={busy}>
          {busy ? "Writing…" : o.coverLetter ? (gemini ? "✦ Rewrite" : "Regenerate") : gemini ? "✦ Write my cover letter" : "Start from a template"}
        </button>
      </div>
      {note && <p className="small" style={{ margin: "8px 0 0" }}>{note}</p>}
      {(o.coverLetter || busy) && (
        <textarea className={`letter ${busy ? "shimmer" : ""}`} value={o.coverLetter} onChange={(e) => setLetter(e.target.value)} />
      )}
    </div>
  );
}

function Links({ o, setLinks }: { o: Opportunity; setLinks: (l: Opportunity["links"]) => void }) {
  const [d, setD] = useState({ title: "", url: "" });
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title && !d.url) return;
    let url = d.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    setLinks([...o.links, { id: newId(), title: d.title.trim() || url, url, note: "" }]);
    setD({ title: "", url: "" });
  };
  const q = encodeURIComponent(o.organization);
  return (
    <div className="card">
      <h2>Research &amp; resources · {o.links.length}</h2>
      {o.links.map((l) => (
        <div key={l.id} className="res">
          {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a> : <strong>{l.title}</strong>}
          <button type="button" className="link small" onClick={() => setLinks(o.links.filter((x) => x.id !== l.id))}>Remove</button>
        </div>
      ))}
      <p className="small muted" style={{ margin: "4px 0 8px" }}>
        Quick research: <a href={`https://www.linkedin.com/search/results/people/?keywords=${q}`} target="_blank" rel="noreferrer">people there</a>
        {" · "}<a href={`https://www.glassdoor.ca/Search/results.htm?keyword=${q}`} target="_blank" rel="noreferrer">interviews</a>
        {" · "}<a href={`https://news.google.com/search?q=${q}`} target="_blank" rel="noreferrer">news</a>
      </p>
      <form className="res-form" onSubmit={add}>
        <input placeholder="Title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        <input placeholder="Link" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
        <div className="full"><button>Add link</button></div>
      </form>
    </div>
  );
}
