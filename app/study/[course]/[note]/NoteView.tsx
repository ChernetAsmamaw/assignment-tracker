"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crumbs, Prop } from "@/components/Doc";
import { SourceCard, useHoverCard } from "@/components/SourceCard";
import { deleteChunks, loadChunks, type StoredChunk } from "@/lib/audio-store";
import { formatDay } from "@/lib/format";
import { clock, type Lecture, type LectureNotes, type Segment, type SourcedLine } from "@/lib/lectures";
import { serial } from "@/lib/serial";
import { CONCEPT_STATUS, studyHref, type ConceptStatus } from "@/lib/study";
import Recorder, { type RecorderHandle } from "./Recorder";

export interface ClassConcept {
  id: string;
  name: string;
  status: ConceptStatus;
}

export default function NoteView({ lecture: initial, course, courses, concepts, gemini }: {
  lecture: Lecture;
  course: { code: string; color: string };
  courses: string[];
  concepts: ClassConcept[]; // the course's concepts that were taught in this class
  gemini: boolean;
}) {
  const router = useRouter();
  const [lecture, setLecture] = useState(initial);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState("");
  const [live, setLive] = useState(false);
  const [peek, setPeek] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]); // transcript lines opened from a note
  const [flash, setFlash] = useState<string | null>(null);
  const [hoverSeg, setHoverSeg] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [paste, setPaste] = useState(false);
  const [chunks, setChunks] = useState<StoredChunk[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mine, setMine] = useState(initial.myNotes ?? "");
  const [mineState, setMineState] = useState<"" | "saving" | "saved">("");
  const mineTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unsaved = useRef<string | null>(null); // typed but not saved yet
  const [queue] = useState(serial);
  const { hover, bind, keep, hide, close } = useHoverCard<SourcedLine>();
  const rec = useRef<RecorderHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const audio = useRef<{ el: HTMLAudioElement; url: string } | null>(null);

  const code = lecture.courseCode;
  const byId = useMemo(() => new Map(lecture.segments.map((s) => [s.id, s])), [lecture.segments]);
  const notes = lecture.notes;
  const hasTranscript = lecture.segments.length > 0;
  const stale = notes && lecture.segments.length > notes.segmentCount ? lecture.segments.length - notes.segmentCount : 0;
  const checked = new Set(lecture.checked ?? []);

  // Which notes cite each transcript line, so hovering the transcript lights up the notes.
  const citedBy = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const { key, sources } of allLines(notes)) for (const id of sources) (m.get(id) ?? m.set(id, new Set()).get(id)!).add(key);
    return m;
  }, [notes]);
  const litNotes = hoverSeg ? citedBy.get(hoverSeg) : undefined;
  const litSegs = useMemo(() => new Set([...(hover?.data.sources ?? []), ...pinned]), [hover, pinned]);

  const refreshAudio = useCallback(() => void loadChunks(lecture.id).then((c) => setChunks(c.sort((a, b) => a.offset - b.offset))), [lecture.id]);
  useEffect(refreshAudio, [refreshAudio]);
  useEffect(() => () => audio.current?.el.pause(), []);

  // Links from the course page land on a transcript line: show the notes that came from it.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || !byId.has(id)) return;
    setPinned([id]);
    const key = [...(citedBy.get(id) ?? [])][0];
    if (!key) return setPeek(true);
    setFlash(key);
    document.querySelector(`[data-note="${key}"]`)?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the lines being looked at in view in the transcript panel.
  useEffect(() => {
    const box = scroller.current;
    const first = [...litSegs][0];
    if (!peek || !box || !first) return;
    const row = box.querySelector<HTMLElement>(`[data-seg="${first}"]`);
    if (!row) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 20 || top > box.scrollTop + box.clientHeight - 60) box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
  }, [litSegs, peek]);

  const hasAudio = (seg: Segment) => chunks.some((c) => seg.start >= c.offset && seg.start < c.offset + c.length);
  const play = (seg: Segment) => {
    if (playing === seg.id && audio.current) {
      audio.current.el.pause();
      return setPlaying(null);
    }
    const start = (chunk: StoredChunk, at: number) => {
      audio.current?.el.pause();
      if (audio.current) URL.revokeObjectURL(audio.current.url);
      const url = URL.createObjectURL(chunk.blob);
      const el = new Audio(url);
      el.currentTime = Math.max(0, at - chunk.offset);
      // Keep playing into the next minute of the recording.
      el.onended = () => {
        const next = chunks.find((c) => c.offset >= chunk.offset + chunk.length - 0.5);
        if (next) start(next, next.offset);
        else setPlaying(null);
      };
      audio.current = { el, url };
      void el.play();
      setPlaying(seg.id);
    };
    const chunk = chunks.find((c) => seg.start >= c.offset && seg.start < c.offset + c.length);
    if (chunk) start(chunk, seg.start);
  };

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
    // The notes are written from your own notes too, so save what was just typed first.
    const typed = unsaved.current;
    if (typed !== null) {
      clearTimeout(mineTimer.current);
      unsaved.current = null;
      await queue(() => fetch(`/api/lectures/${lecture.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ myNotes: typed }) }));
      setLecture((l) => ({ ...l, myNotes: typed }));
      setMineState("saved");
    }
    await queue(async () => undefined); // let any save still on its way land first
    const res = await fetch(`/api/lectures/${lecture.id}/notes`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setWriting(false);
    if (!res.ok) return setErr(body.error ?? "Couldn't write the notes. Try again.");
    setLecture((l) => ({ ...l, notes: body as LectureNotes }));
    // New notes can teach new concepts: refresh the course's list in the background.
    void fetch(`/api/study/${encodeURIComponent(code)}/concepts`, { method: "POST" }).then(() => router.refresh());
  }, [lecture.id, code, router, queue]);

  const onFinished = useCallback(() => {
    refreshAudio();
    void writeNotes();
  }, [refreshAudio, writeNotes]);

  const save = async (patch: Partial<Pick<Lecture, "title" | "courseCode" | "myNotes" | "checked">> & { transcript?: string }) => {
    const res = await queue(() => fetch(`/api/lectures/${lecture.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(body.error ?? "Couldn't save.");
      return false;
    }
    if (patch.transcript) setLecture((l) => ({ ...l, segments: body.segments, duration: body.duration }));
    return true;
  };

  const moveTo = async (next: string) => {
    if (next === code || !(await save({ courseCode: next }))) return;
    router.replace(studyHref(next, lecture.id));
    router.refresh();
  };

  const toggle = (text: string) => {
    const next = checked.has(text) ? [...checked].filter((t) => t !== text) : [...checked, text];
    setLecture((l) => ({ ...l, checked: next }));
    void save({ checked: next });
  };

  const remove = async () => {
    setMenu(false);
    if (!confirm("Delete this class, its transcript and notes?")) return;
    await fetch(`/api/lectures/${lecture.id}`, { method: "DELETE" });
    await deleteChunks(lecture.id);
    router.push(studyHref(code));
    router.refresh();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(markdown(lecture, byId));
    setCopied(true);
    setTimeout(() => (setCopied(false), setMenu(false)), 1200);
  };

  const line = (key: string, l: SourcedLine) => {
    const first = byId.get(l.sources[0]);
    return (
      <span data-note={key} {...bind(key, l)} className={`src ${hover?.key === key ? "on" : ""} ${litNotes?.has(key) ? "lit" : ""} ${flash === key ? "flash" : ""}`}>
        {l.text}
        {first && <span className="src-tag">{clock(first.start)}</span>}
      </span>
    );
  };

  // Your own notes save as you type; they also steer what the written notes focus on.
  const typeMine = (text: string) => {
    setMine(text);
    setMineState("saving");
    unsaved.current = text;
    clearTimeout(mineTimer.current);
    mineTimer.current = setTimeout(async () => {
      unsaved.current = null;
      setLecture((l) => ({ ...l, myNotes: text }));
      setMineState((await save({ myNotes: text })) ? "saved" : "");
    }, 700);
  };
  const myNotes = <MyNotes value={mine} onChange={typeMine} state={mineState} focus={live} />;

  return (
    <div className={`doc-wrap ${peek ? "peeking" : ""}`}>
      <article className="doc">
        <div className="doc-top">
          <Crumbs trail={[{ label: "Study", href: "/study" }, { label: code, href: studyHref(code) }, { label: lecture.title }]} />
          <div className="doc-actions">
            {hasTranscript && !live && <button type="button" className="ghost" onClick={() => rec.current?.start()}><span className="rec-dot small" /> Record</button>}
            {hasTranscript && <button type="button" className={`ghost ${peek ? "on" : ""}`} onClick={() => (setPeek(!peek), setPinned([]))}>Transcript</button>}
            <div className="menu-wrap">
              <button type="button" className="ghost" onClick={() => setMenu(!menu)} aria-label="More" aria-expanded={menu}>⋯</button>
              {menu && (
                <>
                  <div className="menu-backdrop" onClick={() => setMenu(false)} />
                  <div className="menu" role="menu">
                    {notes && <button type="button" role="menuitem" onClick={copy}>{copied ? "Copied" : "Copy as Markdown"}</button>}
                    {hasTranscript && <button type="button" role="menuitem" disabled={writing} onClick={() => (setMenu(false), writeNotes())}>{notes ? "Rewrite notes" : "Write notes"}</button>}
                    <button type="button" role="menuitem" className="danger" onClick={remove}>Delete</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="doc-icon" aria-hidden>{notes ? "📝" : "🎙️"}</div>
        <input
          className="doc-title"
          defaultValue={lecture.title}
          aria-label="Title"
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title && title !== lecture.title) (setLecture((l) => ({ ...l, title })), save({ title }));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />

        <div className="props">
          <Prop icon="◉" label="Course">
            <select className="pill-select" style={{ ["--pill" as string]: course.color }} value={code} onChange={(e) => moveTo(e.target.value)} aria-label="Course">
              {[...new Set([code, ...courses])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Prop>
          <Prop icon="▦" label="Date">{formatDay(lecture.createdAt, true)}</Prop>
          <Prop icon="◷" label="Length">{lecture.duration > 0 ? clock(lecture.duration) : <span className="faint">Not recorded yet</span>}</Prop>
          {notes && <Prop icon="✦" label="Notes">{notes.ai ? "Written by Gemini from the transcript" : "Picked from the transcript"}</Prop>}
        </div>

        <Recorder
          ref={rec}
          lectureId={lecture.id}
          offset={lecture.duration}
          gemini={gemini}
          inline={!hasTranscript}
          extra={<button type="button" className="ghost" onClick={() => setPaste(!paste)}>Paste a transcript instead</button>}
          onLive={setLive}
          onSegments={onSegments}
          onFinished={onFinished}
        />
        {!hasTranscript && paste && !live && <PasteTranscript onSave={(t) => save({ transcript: t })} />}

        {err && <div className="callout warn"><span className="callout-ico" aria-hidden>⚠️</span><div>{err}</div></div>}

        {!notes ? (
          (hasTranscript || live) && (
            <>
              {live ? (
                <p className="doc-hint">Type anything you want to remember. When you stop, Pace writes the full notes from the transcript and uses yours to decide what matters.</p>
              ) : (
                <div className="callout">
                  <span className="callout-ico" aria-hidden>✦</span>
                  <div>
                    {writing ? (
                      <>
                        <strong>Writing your notes from the transcript…</strong>
                        <div className="doc-shimmer"><i /><i /><i /></div>
                      </>
                    ) : (
                      <>
                        <strong>{lecture.segments.length} transcript lines, ready for notes</strong>
                        <p>Every note will link back to the words it came from.</p>
                        <button type="button" className="doc-btn" onClick={writeNotes}>{gemini ? "✦ Write notes" : "Write notes"}</button>
                      </>
                    )}
                  </div>
                </div>
              )}
              <h2>My notes</h2>
              {myNotes}
            </>
          )
        ) : (
          <>
            {stale > 0 && !live && (
              <div className="callout soft">
                <span className="callout-ico" aria-hidden>↻</span>
                <div>
                  {stale} new transcript line{stale === 1 ? "" : "s"} since these notes were written.{" "}
                  <button type="button" className="inline-link" onClick={writeNotes} disabled={writing}>{writing ? "Rewriting…" : "Rewrite notes"}</button>
                </div>
              </div>
            )}

            <div className="callout">
              <span className="callout-ico" aria-hidden>💡</span>
              <p className="doc-summary">{notes.summary.map((l, i) => <span key={i}>{line(`sum${i}`, l)} </span>)}</p>
            </div>

            {notes.actions.length > 0 && (
              <>
                <h2>To do</h2>
                {notes.actions.map((l, i) => (
                  <div key={i} className={`todo ${checked.has(l.text) ? "done" : ""}`}>
                    <input type="checkbox" checked={checked.has(l.text)} onChange={() => toggle(l.text)} aria-label="Done" />
                    {line(`act${i}`, l)}
                  </div>
                ))}
              </>
            )}

            {notes.sections.map((sec, si) => (
              <section key={si}>
                <h2>{sec.heading}</h2>
                <ul>{sec.bullets.map((l, bi) => <li key={bi}>{line(`sec${si}-${bi}`, l)}</li>)}</ul>
              </section>
            ))}

            {notes.terms.length > 0 && (
              <>
                <h2>Key terms</h2>
                <table className="doc-table">
                  <thead><tr><th>Term</th><th>What it means</th></tr></thead>
                  <tbody>
                    {notes.terms.map((t, i) => (
                      <tr key={i}>
                        <td>{t.term}</td>
                        <td>{line(`term${i}`, { text: t.definition, sources: t.sources })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {concepts.length > 0 && (
              <>
                <h2>Concepts from this class</h2>
                <div className="doc-links">
                  {concepts.map((c) => (
                    <Link key={c.id} href={`${studyHref(code)}#${c.id}`} className="doc-link">
                      <span className={`pill cs-${c.status}`}>{CONCEPT_STATUS[c.status]}</span>
                      <span>{c.name}</span>
                      <span className="faint">→</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            <h2>My notes</h2>
            {myNotes}

            <p className="doc-foot">
              Hover any line to see the words it came from.
              {notes.dropped > 0 && ` ${notes.dropped} line${notes.dropped === 1 ? "" : "s"} with no source in the transcript ${notes.dropped === 1 ? "was" : "were"} left out.`}
            </p>
          </>
        )}
      </article>

      {peek && (
        <aside className="peek" aria-label="Transcript">
          <div className="peek-head">
            <strong>Transcript</strong>
            <span className="faint">{lecture.segments.length} lines</span>
            <button type="button" className="ghost" onClick={() => (setPeek(false), setPinned([]))} aria-label="Close transcript">×</button>
          </div>
          <div className="peek-body" ref={scroller}>
            {lecture.segments.map((s) => (
              <div
                key={s.id}
                data-seg={s.id}
                className={`seg-row ${litSegs.has(s.id) ? "lit" : ""} ${citedBy.has(s.id) ? "cited" : ""}`}
                onMouseEnter={() => setHoverSeg(s.id)}
                onMouseLeave={() => setHoverSeg(null)}
              >
                <button type="button" className="seg-time" onClick={() => hasAudio(s) && play(s)} disabled={!hasAudio(s)} title={hasAudio(s) ? "Play from here" : "The audio isn't on this device"}>
                  {playing === s.id ? "❚❚" : clock(s.start)}
                </button>
                <span>{s.text}</span>
              </div>
            ))}
            <details className="peek-add">
              <summary>Add more transcript</summary>
              <PasteTranscript onSave={(t) => save({ transcript: t })} />
            </details>
          </div>
        </aside>
      )}

      {hover && (
        <SourceCard
          hover={hover}
          note={hover.data.text}
          onEnter={keep}
          onLeave={hide}
          quotes={hover.data.sources.flatMap((id) => {
            const seg = byId.get(id);
            return seg ? [{ key: id, time: clock(seg.start), text: seg.text, onPlay: hasAudio(seg) ? () => play(seg) : undefined, playing: playing === id }] : [];
          })}
          footer={
            <button type="button" className="src-more" onClick={() => (setPinned(hover.data.sources), setPeek(true), close())}>
              Show in transcript →
            </button>
          }
        />
      )}
    </div>
  );
}

// A borderless box that grows with what you type, like a Notion text block.
function MyNotes({ value, onChange, state, focus }: { value: string; onChange: (text: string) => void; state: string; focus: boolean }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) (el.style.height = "auto"), (el.style.height = `${el.scrollHeight}px`);
  }, [value]);
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus]);
  return (
    <div className="mine">
      <textarea ref={box} value={value} rows={2} placeholder="Type your own notes…" onChange={(e) => onChange(e.target.value)} aria-label="My notes" />
      {state && <span className="mine-state">{state === "saving" ? "Saving…" : "Saved"}</span>}
    </div>
  );
}

function PasteTranscript({ onSave }: { onSave: (text: string) => Promise<boolean> }) {
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
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"0:00 Okay, let's get started. Today we're looking at…\n(lines can start with a time like 12:30)"} />
      <button type="submit" className="doc-btn" disabled={busy || !text.trim()}>{busy ? "Adding…" : "Add transcript"}</button>
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

function markdown(l: Lecture, byId: Map<string, Segment>): string {
  const n = l.notes;
  if (!n) return "";
  const at = (s: string[]) => {
    const seg = byId.get(s[0]);
    return seg ? ` [${clock(seg.start)}]` : "";
  };
  const done = new Set(l.checked ?? []);
  return [
    `# ${l.courseCode}: ${l.title}`,
    formatDay(l.createdAt, true),
    "",
    "## Summary",
    n.summary.map((x) => x.text).join(" "),
    ...(n.actions.length ? ["", "## To do", ...n.actions.map((x) => `- [${done.has(x.text) ? "x" : " "}] ${x.text}${at(x.sources)}`)] : []),
    ...n.sections.flatMap((s) => ["", `## ${s.heading}`, ...s.bullets.map((x) => `- ${x.text}${at(x.sources)}`)]),
    ...(n.terms.length ? ["", "## Key terms", ...n.terms.map((t) => `- **${t.term}**: ${t.definition}${at(t.sources)}`)] : []),
    ...(l.myNotes?.trim() ? ["", "## My notes", l.myNotes.trim()] : []),
  ].join("\n");
}
