"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteChunks, loadChunks, type StoredChunk } from "@/lib/audio-store";
import { clock, type Lecture, type LectureNotes, type Segment, type SourcedLine } from "@/lib/lectures";
import Recorder from "./Recorder";

interface Pop {
  key: string;
  text: string;
  sources: string[];
  x: number;
  y: number;
  above: boolean;
}

export default function LectureView({ lecture: initial, courses, color, gemini }: { lecture: Lecture; courses: string[]; color: string; gemini: boolean }) {
  const router = useRouter();
  const [lecture, setLecture] = useState(initial);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState("");
  const [pop, setPop] = useState<Pop | null>(null);
  const [hoverSeg, setHoverSeg] = useState<string | null>(null);
  const [chunks, setChunks] = useState<StoredChunk[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const audio = useRef<{ el: HTMLAudioElement; url: string; chunk: StoredChunk } | null>(null);

  const byId = useMemo(() => new Map(lecture.segments.map((s) => [s.id, s])), [lecture.segments]);
  const notes = lecture.notes;
  const stale = notes && lecture.segments.length > notes.segmentCount ? lecture.segments.length - notes.segmentCount : 0;

  // Which notes cite each transcript segment, so hovering the transcript lights up the notes.
  const citedBy = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const { key, sources } of allLines(notes)) for (const id of sources) (m.get(id) ?? m.set(id, new Set()).get(id)!).add(key);
    return m;
  }, [notes]);
  const litNotes = hoverSeg ? citedBy.get(hoverSeg) : undefined;
  const litSegs = useMemo(() => new Set(pop?.sources ?? []), [pop]);

  const refreshAudio = useCallback(() => void loadChunks(lecture.id).then((c) => setChunks(c.sort((a, b) => a.offset - b.offset))), [lecture.id]);
  useEffect(refreshAudio, [refreshAudio]);
  useEffect(() => () => audio.current?.el.pause(), []);

  // Bring the cited lines into view in the transcript panel (not the page).
  useEffect(() => {
    const box = scroller.current;
    const first = pop?.sources[0];
    if (!box || !first) return;
    const row = box.querySelector<HTMLElement>(`[data-seg="${first}"]`);
    if (!row) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 20 || top > box.scrollTop + box.clientHeight - 60) box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
  }, [pop]);

  const show = (key: string, line: SourcedLine, el: HTMLElement) => {
    clearTimeout(hideTimer.current);
    const r = el.getBoundingClientRect();
    const above = r.bottom > window.innerHeight * 0.62;
    const x = Math.min(Math.max(12, r.left), window.innerWidth - Math.min(420, window.innerWidth - 24) - 12);
    setPop({ key, text: line.text, sources: line.sources, x, y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPop(null), 180);
  };
  const keep = () => clearTimeout(hideTimer.current);

  const play = (seg: Segment) => {
    const cur = audio.current;
    if (playing === seg.id && cur) {
      cur.el.pause();
      return setPlaying(null);
    }
    const start = (chunk: StoredChunk, at: number, segId: string) => {
      audio.current?.el.pause();
      if (audio.current) URL.revokeObjectURL(audio.current.url);
      const url = URL.createObjectURL(chunk.blob);
      const el = new Audio(url);
      el.currentTime = Math.max(0, at - chunk.offset);
      // Keep playing into the next minute of the recording.
      el.onended = () => {
        const next = chunks.find((c) => c.offset >= chunk.offset + chunk.length - 0.5);
        if (next) start(next, next.offset, segId);
        else setPlaying(null);
      };
      audio.current = { el, url, chunk };
      void el.play();
      setPlaying(segId);
    };
    const chunk = chunks.find((c) => seg.start >= c.offset && seg.start < c.offset + c.length);
    if (chunk) start(chunk, seg.start, seg.id);
  };
  const hasAudio = (seg: Segment) => chunks.some((c) => seg.start >= c.offset && seg.start < c.offset + c.length);

  const onSegments = useCallback((added: Segment[], duration: number) => {
    setLecture((l) => {
      // A retried chunk replaces the lines in its time window, as on the server.
      const from = added[0]?.start ?? Infinity;
      const to = added.at(-1)?.end ?? -Infinity;
      const kept = l.segments.filter((s) => s.start < from || s.start >= to);
      return { ...l, duration: Math.max(l.duration, duration), segments: [...kept, ...added].sort((a, b) => a.start - b.start) };
    });
  }, []);

  const writeNotes = useCallback(async () => {
    setWriting(true);
    setErr("");
    const res = await fetch(`/api/lectures/${lecture.id}/notes`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setWriting(false);
    if (!res.ok) return setErr(body.error ?? "Couldn't write the notes. Try again.");
    setLecture((l) => ({ ...l, notes: body as LectureNotes }));
    router.refresh();
  }, [lecture.id, router]);

  const onFinished = useCallback(() => {
    refreshAudio();
    void writeNotes();
  }, [refreshAudio, writeNotes]);

  const save = async (patch: Partial<Pick<Lecture, "title" | "courseCode">> & { transcript?: string }) => {
    const res = await fetch(`/api/lectures/${lecture.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(body.error ?? "Couldn't save.");
    setLecture((l) => ({ ...body, notes: body.notes ?? l.notes }));
    return true;
  };

  const remove = async () => {
    if (!confirm("Delete this class, its transcript and notes?")) return;
    await fetch(`/api/lectures/${lecture.id}`, { method: "DELETE" });
    await deleteChunks(lecture.id);
    router.push("/lectures");
    router.refresh();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(markdown(lecture, byId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Props for every note that can show its source.
  const src = (key: string, line: SourcedLine) => ({
    tabIndex: 0,
    className: `src ${pop?.key === key ? "on" : ""} ${litNotes?.has(key) ? "lit" : ""}`,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(key, line, e.currentTarget),
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(key, line, e.currentTarget),
    onBlur: hide,
    onClick: (e: React.MouseEvent<HTMLElement>) => show(key, line, e.currentTarget),
  });
  const stamp = (line: SourcedLine) => {
    const first = byId.get(line.sources[0]);
    return first ? <span className="src-tag">{clock(first.start)}</span> : null;
  };

  return (
    <>
      <header className="page-head lec-head" style={{ ["--course" as string]: color }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <span className="eyebrow">
            <Link href={`/lectures?course=${encodeURIComponent(lecture.courseCode)}`} style={{ color: "inherit" }}>{lecture.courseCode || "Class"}</Link>
            {" · "}
            {new Date(lecture.createdAt).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}
            {lecture.duration > 0 && ` · ${clock(lecture.duration)}`}
          </span>
          <input
            className="lec-title"
            defaultValue={lecture.title}
            aria-label="Class title"
            onBlur={(e) => e.target.value.trim() !== lecture.title && save({ title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <div className="lec-actions">
          <select value={lecture.courseCode} onChange={(e) => save({ courseCode: e.target.value })} aria-label="Course">
            {[...new Set([lecture.courseCode, ...courses])].map((c) => <option key={c} value={c}>{c || "No course"}</option>)}
          </select>
          {notes && <button type="button" onClick={copy}>{copied ? "Copied" : "Copy notes"}</button>}
        </div>
      </header>

      <Recorder lectureId={lecture.id} offset={lecture.duration} gemini={gemini} onSegments={onSegments} onFinished={onFinished} />

      {err && <div className="banner">{err}</div>}

      <div className="lec-grid">
        <section className="lec-notes">
          {!lecture.segments.length ? (
            <div className="lec-empty">
              <strong>Notes appear here after class</strong>
              <p className="muted small">Press record when class starts. When you stop, Pace writes a summary, notes by topic, key terms and anything you were told to do, using only what was said. Hover any line to see where it came from.</p>
              <PasteTranscript onSave={(t) => save({ transcript: t })} />
            </div>
          ) : !notes ? (
            <div className="lec-empty">
              <strong>{writing ? "Writing your notes…" : "Ready to write notes"}</strong>
              <p className="muted small">{lecture.segments.length} transcript lines so far.</p>
              {writing ? <div className="shimmer" style={{ height: 80, borderRadius: 12 }} /> : <button className="primary" onClick={writeNotes}>{gemini ? "✦ Write notes" : "Write notes"}</button>}
            </div>
          ) : (
            <>
              {stale > 0 && (
                <div className="lec-stale small">
                  {stale} new transcript line{stale === 1 ? "" : "s"} since these notes were written.
                  <button type="button" className="link" onClick={writeNotes} disabled={writing}>{writing ? "Rewriting…" : "Rewrite notes"}</button>
                </div>
              )}

              <div className="card lec-summary">
                <div className="row-between">
                  <h2>Summary</h2>
                  <span className="ai-badge">{notes.ai ? "✦ Gemini, from the transcript" : "Picked from the transcript"}</span>
                </div>
                <p>
                  {notes.summary.map((l, i) => (
                    <span key={i}><span {...src(`sum${i}`, l)}>{l.text}</span>{" "}</span>
                  ))}
                </p>
              </div>

              {notes.actions.length > 0 && (
                <div className="card lec-actions-card">
                  <h2>To do from this class</h2>
                  <ul>
                    {notes.actions.map((l, i) => (
                      <li key={i}><span {...src(`act${i}`, l)}>{l.text}{stamp(l)}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {notes.sections.map((sec, si) => (
                <div key={si} className="lec-section">
                  <h3>{sec.heading}</h3>
                  <ul>
                    {sec.bullets.map((l, bi) => (
                      <li key={bi}><span {...src(`sec${si}-${bi}`, l)}>{l.text}{stamp(l)}</span></li>
                    ))}
                  </ul>
                </div>
              ))}

              {notes.terms.length > 0 && (
                <div className="lec-section">
                  <h3>Key terms</h3>
                  <dl className="lec-terms">
                    {notes.terms.map((t, i) => (
                      <div key={i} {...src(`term${i}`, { text: `${t.term}: ${t.definition}`, sources: t.sources })}>
                        <dt>{t.term}</dt>
                        <dd>{t.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <p className="muted small lec-foot">
                Every line links to what was said: hover or tap it to see the source.
                {notes.dropped > 0 && ` ${notes.dropped} line${notes.dropped === 1 ? "" : "s"} with no source in the transcript ${notes.dropped === 1 ? "was" : "were"} left out.`}
                {" "}<button type="button" className="link small" onClick={writeNotes} disabled={writing}>{writing ? "Rewriting…" : "Rewrite"}</button>
              </p>
            </>
          )}
        </section>

        <aside className="lec-transcript card">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Transcript</h2>
            <span className="muted small">{lecture.segments.length} lines</span>
          </div>
          <div className="lec-scroll" ref={scroller}>
            {lecture.segments.length === 0 && <p className="muted small">Nothing yet.</p>}
            {lecture.segments.map((s) => (
              <div
                key={s.id}
                data-seg={s.id}
                className={`seg-row ${litSegs.has(s.id) ? "lit" : ""} ${citedBy.has(s.id) ? "cited" : ""}`}
                onMouseEnter={() => setHoverSeg(s.id)}
                onMouseLeave={() => setHoverSeg(null)}
              >
                <button type="button" className="seg-time" onClick={() => hasAudio(s) && play(s)} title={hasAudio(s) ? "Play from here" : "Audio isn't on this device"} disabled={!hasAudio(s)}>
                  {playing === s.id ? "❚❚" : clock(s.start)}
                </button>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
          {lecture.segments.length > 0 && (
            <details className="small" style={{ marginTop: 10 }}>
              <summary className="muted">Add more transcript</summary>
              <PasteTranscript onSave={(t) => save({ transcript: t })} />
            </details>
          )}
        </aside>
      </div>

      <p style={{ marginTop: 24 }}><button type="button" className="link small" onClick={remove}>Delete this class</button></p>

      {pop && (
        <div
          className={`src-pop ${pop.above ? "above" : ""}`}
          style={{ left: pop.x, top: pop.y }}
          onMouseEnter={keep}
          onMouseLeave={hide}
          role="dialog"
          aria-label="Source in the transcript"
        >
          <div className="src-pop-head">From the transcript</div>
          {pop.sources.map((id) => {
            const seg = byId.get(id);
            if (!seg) return null;
            return (
              <div key={id} className="src-quote">
                <button type="button" className="seg-time" onClick={() => hasAudio(seg) && play(seg)} disabled={!hasAudio(seg)} title={hasAudio(seg) ? "Play from here" : "Audio isn't on this device"}>
                  {playing === seg.id ? "❚❚" : hasAudio(seg) ? `▶ ${clock(seg.start)}` : clock(seg.start)}
                </button>
                <q>{highlight(seg.text, pop.text)}</q>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function PasteTranscript({ onSave }: { onSave: (text: string) => Promise<true | void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="paste"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onSave(text)) setText("");
        setBusy(false);
      }}
    >
      <label className="small muted">Or paste a transcript (lines can start with a time like 12:30)</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="00:00 Okay, let's get started. Today we're looking at…" style={{ minHeight: 90 }} />
      <button type="submit" disabled={busy || !text.trim()}>{busy ? "Adding…" : "Add transcript"}</button>
    </form>
  );
}

function allLines(notes: LectureNotes | null): { key: string; sources: string[] }[] {
  if (!notes) return [];
  return [
    ...notes.summary.map((l, i) => ({ key: `sum${i}`, sources: l.sources })),
    ...notes.actions.map((l, i) => ({ key: `act${i}`, sources: l.sources })),
    ...notes.sections.flatMap((s, si) => s.bullets.map((l, bi) => ({ key: `sec${si}-${bi}`, sources: l.sources }))),
    ...notes.terms.map((t, i) => ({ key: `term${i}`, sources: t.sources })),
  ];
}

// Marks the words in the quote that also appear in the note, so it's clear what supports what.
const COMMON = new Set("the and that this with from they them then than have what when which were will would there their about into your just like okay".split(" "));
function highlight(quote: string, note: string) {
  const words = new Set((note.toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) ?? []).filter((w) => !COMMON.has(w)));
  return quote.split(/(\s+)/).map((w, i) => {
    const bare = w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    return bare.length > 3 && words.has(bare) ? <mark key={i}>{w}</mark> : w;
  });
}

function markdown(l: Lecture, byId: Map<string, Segment>): string {
  const n = l.notes;
  if (!n) return "";
  const at = (s: string[]) => {
    const seg = byId.get(s[0]);
    return seg ? ` [${clock(seg.start)}]` : "";
  };
  return [
    `# ${l.courseCode ? `${l.courseCode}: ` : ""}${l.title}`,
    new Date(l.createdAt).toLocaleDateString("en-CA", { dateStyle: "long" }),
    "",
    "## Summary",
    n.summary.map((x) => x.text).join(" "),
    ...(n.actions.length ? ["", "## To do", ...n.actions.map((x) => `- ${x.text}${at(x.sources)}`)] : []),
    ...n.sections.flatMap((s) => ["", `## ${s.heading}`, ...s.bullets.map((x) => `- ${x.text}${at(x.sources)}`)]),
    ...(n.terms.length ? ["", "## Key terms", ...n.terms.map((t) => `- **${t.term}**: ${t.definition}${at(t.sources)}`)] : []),
  ].join("\n");
}
