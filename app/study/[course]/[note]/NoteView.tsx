"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crumbs } from "@/components/Doc";
import { SourceCard, useHoverCard } from "@/components/SourceCard";
import { deleteChunks, loadChunks, type StoredChunk } from "@/lib/audio-store";
import { formatDate, isDay } from "@/lib/format";
import { clock, noteDay, noteTitle, type Lecture, type LectureNotes, type Segment, type SourcedLine } from "@/lib/lectures";
import { serial } from "@/lib/serial";
import { studyHref } from "@/lib/study";
import Recorder, { type RecorderHandle } from "./Recorder";

type SaveState = "" | "saving" | "saved" | "failed";

// A note is a page you write on. Recording a class is optional: its transcript-sourced
// notes appear under yours, and every line links back to the words it came from.
export default function NoteView({ lecture: initial, courses, gemini }: {
  lecture: Lecture;
  courses: string[];
  gemini: boolean;
}) {
  const router = useRouter();
  const [lecture, setLecture] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(noteDay(initial));
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
  const [saveState, setSaveState] = useState<SaveState>("");
  const typed = useRef<{ title?: string; myNotes?: string } | null>(null); // typed but not saved yet
  const typeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [queue] = useState(serial);
  const { hover, bind, keep, hide, close } = useHoverCard<SourcedLine>();
  const rec = useRef<RecorderHandle>(null);
  const titleBox = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
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

  useAutoHeight(titleBox, title); // the title wraps onto more lines as it grows

  // Links to a transcript line land on it: show the notes that came from it.
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

  const save = useCallback(
    async (patch: Partial<Pick<Lecture, "title" | "date" | "courseCode" | "myNotes" | "checked">> & { transcript?: string }) => {
      const res = await queue(() =>
        fetch(`/api/lectures/${lecture.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => null),
      );
      const out = await res?.json().catch(() => ({}));
      if (!res?.ok) {
        setErr(out?.error ?? "Couldn't save. Check your connection and try again.");
        return false;
      }
      setErr("");
      if (patch.transcript) setLecture((l) => ({ ...l, segments: out.segments, duration: out.duration }));
      return true;
    },
    [lecture.id, queue],
  );

  // The title and your notes save as you type, after a short pause.
  const flush = useCallback(async () => {
    clearTimeout(typeTimer.current);
    const patch = typed.current;
    if (!patch) return;
    typed.current = null;
    const ok = await save(patch);
    if (!ok) typed.current = { ...patch, ...(typed.current ?? {}) }; // sent again with the next save
    // Anything typed while this save was on its way is still waiting for its own.
    setSaveState(ok ? (typed.current ? "saving" : "saved") : "failed");
  }, [save]);
  const type = (patch: { title?: string; myNotes?: string }) => {
    typed.current = { ...typed.current, ...patch };
    setSaveState("saving");
    clearTimeout(typeTimer.current);
    typeTimer.current = setTimeout(() => void flush(), 700);
  };

  // Leaving the page saves what was just typed instead of waiting for the pause.
  useEffect(() => () => void flush(), [flush]);
  useEffect(() => {
    const onHide = () => {
      const patch = typed.current;
      if (!patch) return;
      typed.current = null;
      void fetch(`/api/lectures/${lecture.id}`, { method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [lecture.id]);

  const writeNotes = useCallback(async () => {
    setWriting(true);
    setErr("");
    // Your notes steer the class notes, so save what was just typed first.
    await flush();
    await queue(async () => undefined); // let any save still on its way land first
    const res = await fetch(`/api/lectures/${lecture.id}/notes`, { method: "POST" }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    setWriting(false);
    if (!res?.ok) return setErr(out?.error ?? "Couldn't write the notes. Try again.");
    setLecture((l) => ({ ...l, notes: out as LectureNotes }));
  }, [lecture.id, queue, flush]);

  const onFinished = useCallback(() => {
    refreshAudio();
    void writeNotes();
  }, [refreshAudio, writeNotes]);

  const redate = (day: string) => {
    if (!isDay(day) || day === date) return;
    setDate(day);
    void save({ date: day });
  };

  const moveTo = async (next: string) => {
    setMenu(false);
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
    if (!confirm("Delete this note? Its recording and transcript go too.")) return;
    // Land what was just typed first, so no save can arrive after the note is gone.
    await flush();
    await queue(async () => undefined);
    const res = await fetch(`/api/lectures/${lecture.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setErr((await res?.json().catch(() => null))?.error ?? "Couldn't delete the note. Try again.");
    clearTimeout(typeTimer.current);
    typed.current = null;
    await deleteChunks(lecture.id);
    router.push(studyHref(code));
    router.refresh();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown({ ...lecture, title, date, myNotes: mine }, byId));
    } catch {
      return (setMenu(false), setErr("Couldn't copy. Your browser blocked the clipboard."));
    }
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

  const others = [...new Set([code, ...courses])].filter((c) => c !== code);

  return (
    <div className={`doc-wrap ${peek ? "peeking" : ""}`}>
      <article className="doc note">
        <div className="doc-top">
          <Crumbs trail={[{ label: "Study", href: "/study" }, { label: code, href: studyHref(code) }, { label: noteTitle({ title }) }]} />
          <div className="doc-actions">
            {saveState && <span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Not saved"}</span>}
            {!live && (
              <button type="button" className="ghost" onClick={() => rec.current?.start()} title="Record the class while you write">
                <span className="rec-dot small" /> Record
              </button>
            )}
            {hasTranscript && <button type="button" className={`ghost ${peek ? "on" : ""}`} onClick={() => (setPeek(!peek), setPinned([]))}>Transcript</button>}
            <div className="menu-wrap">
              <button type="button" className="ghost" onClick={() => setMenu(!menu)} aria-label="More" aria-expanded={menu}>⋯</button>
              {menu && (
                <>
                  <div className="menu-backdrop" onClick={() => setMenu(false)} />
                  <div className="menu" role="menu">
                    {!live && <button type="button" role="menuitem" onClick={() => (setMenu(false), setPaste(!paste))}>Paste a class transcript</button>}
                    {hasTranscript && <button type="button" role="menuitem" disabled={writing} onClick={() => (setMenu(false), writeNotes())}>{notes ? "Rewrite class notes" : "Write class notes"}</button>}
                    <button type="button" role="menuitem" onClick={copy}>{copied ? "Copied" : "Copy as Markdown"}</button>
                    {others.length > 0 && (
                      <>
                        <div className="menu-label">Move to</div>
                        {others.map((c) => <button key={c} type="button" role="menuitem" onClick={() => moveTo(c)}>{c}</button>)}
                      </>
                    )}
                    <button type="button" role="menuitem" className="danger" onClick={remove}>Delete</button>
                  </div>
                </>
              )}
            </div>
            <label className="note-date" title="Change the date">
              <span className="note-date-ico" aria-hidden>▦</span>
              <span>{formatDate(date, true)}</span>
              <input
                type="date"
                value={date}
                required
                aria-label="Date"
                onChange={(e) => redate(e.target.value)}
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker();
                  } catch {}
                }}
              />
            </label>
          </div>
        </div>

        <textarea
          ref={titleBox}
          className="doc-title"
          rows={1}
          autoFocus={!initial.title && !initial.myNotes && !initial.segments.length} // a new note starts in its title
          value={title}
          placeholder="Untitled"
          aria-label="Title"
          onChange={(e) => {
            const next = e.target.value.replace(/\s*\n\s*/g, " ");
            setTitle(next);
            type({ title: next });
          }}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            body.current?.focus();
          }}
        />

        <NoteBody box={body} value={mine} onChange={(text) => (setMine(text), type({ myNotes: text }))} focus={live} />

        {err && <div className="callout warn"><span className="callout-ico" aria-hidden>⚠️</span><div>{err}</div></div>}

        <Recorder
          ref={rec}
          lectureId={lecture.id}
          offset={lecture.duration}
          gemini={gemini}
          onLive={setLive}
          onSegments={onSegments}
          onFinished={onFinished}
        />
        {paste && !live && (
          <PasteTranscript
            onSave={async (t) => {
              const ok = await save({ transcript: t });
              if (ok) setPaste(false);
              return ok;
            }}
          />
        )}

        {(live || hasTranscript) && (
          <section className="from-rec">
            <div className="rec-divider">
              <span>From the class recording{lecture.duration > 0 ? ` · ${clock(lecture.duration)}` : ""}{notes ? (notes.ai ? " · written by Gemini" : " · picked from the transcript") : ""}</span>
            </div>
            {live ? (
              <p className="doc-hint">Recording. Keep writing your notes above. When you stop, notes from the transcript appear here, and yours decide what they focus on.</p>
            ) : !notes ? (
              <div className="callout">
                <span className="callout-ico" aria-hidden>✦</span>
                <div>
                  {writing ? (
                    <>
                      <strong>Writing notes from the transcript…</strong>
                      <div className="doc-shimmer"><i /><i /><i /></div>
                    </>
                  ) : (
                    <>
                      <strong>{lecture.segments.length} transcript lines, ready for notes</strong>
                      <p>Every line will link back to the words it came from.</p>
                      <button type="button" className="doc-btn" onClick={writeNotes}>{gemini ? "✦ Write class notes" : "Write class notes"}</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                {stale > 0 && (
                  <div className="callout soft">
                    <span className="callout-ico" aria-hidden>↻</span>
                    <div>
                      {stale} new transcript line{stale === 1 ? "" : "s"} since these notes were written.{" "}
                      <button type="button" className="inline-link" onClick={writeNotes} disabled={writing}>{writing ? "Rewriting…" : "Rewrite"}</button>
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

                <p className="doc-foot">
                  Hover any line to see the words it came from.
                  {notes.dropped > 0 && ` ${notes.dropped} line${notes.dropped === 1 ? "" : "s"} with no source in the transcript ${notes.dropped === 1 ? "was" : "were"} left out.`}
                </p>
              </>
            )}
          </section>
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

// The page you write on: a borderless box that grows with what you type, like a Notion page.
function NoteBody({ box, value, onChange, focus }: { box: React.RefObject<HTMLTextAreaElement | null>; value: string; onChange: (text: string) => void; focus: boolean }) {
  useAutoHeight(box, value);
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [box, focus]);
  return (
    <div className="mine">
      <textarea ref={box} value={value} rows={1} placeholder="Start writing…" onChange={(e) => onChange(e.target.value)} aria-label="Your notes" />
    </div>
  );
}

// Grows a textarea to fit its text, and again once the fonts load or the window resizes.
function useAutoHeight(box: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const fit = () => {
      const el = box.current;
      if (el) (el.style.height = "auto"), (el.style.height = `${el.scrollHeight}px`);
    };
    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [box, value]);
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
  const at = (s: string[]) => {
    const seg = byId.get(s[0]);
    return seg ? ` [${clock(seg.start)}]` : "";
  };
  const done = new Set(l.checked ?? []);
  return [
    `# ${l.courseCode}: ${noteTitle(l)}`,
    formatDate(noteDay(l), true),
    ...(l.myNotes?.trim() ? ["", l.myNotes.trim()] : []),
    ...(n
      ? [
          "",
          "## From the class recording",
          n.summary.map((x) => x.text).join(" "),
          ...(n.actions.length ? ["", "### To do", ...n.actions.map((x) => `- [${done.has(x.text) ? "x" : " "}] ${x.text}${at(x.sources)}`)] : []),
          ...n.sections.flatMap((s) => ["", `### ${s.heading}`, ...s.bullets.map((x) => `- ${x.text}${at(x.sources)}`)]),
          ...(n.terms.length ? ["", "### Key terms", ...n.terms.map((t) => `- **${t.term}**: ${t.definition}${at(t.sources)}`)] : []),
        ]
      : []),
  ].join("\n");
}
