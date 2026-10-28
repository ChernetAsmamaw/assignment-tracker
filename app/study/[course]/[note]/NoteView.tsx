"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crumbs } from "@/components/Doc";
import { SourceCard, useHoverCard } from "@/components/SourceCard";
import { deleteChunks, loadChunks, type StoredChunk } from "@/lib/audio-store";
import { formatDate, isDay } from "@/lib/format";
import {
  clock,
  draftNotes,
  nextWindow,
  noteDay,
  noteTitle,
  span,
  ONE_GO_SECONDS,
  type Lecture,
  type LectureNotes,
  type NotePart,
  type NotePoint,
  type NoteWindow,
  type Segment,
  type SourcedLine,
} from "@/lib/lectures";
import { serial } from "@/lib/serial";
import { studyHref } from "@/lib/study";
import { allLines, ClassNotes, inline } from "./ClassNotes";
import Recorder, { type RecorderHandle } from "./Recorder";

type SaveState = "" | "saving" | "saved" | "failed";

// A note is a page you write on. Recording a class is optional: its transcript-sourced
// notes appear under yours, and every line links back to the words it came from. During a
// long class they build up every 10 minutes, so they're ready soon after it ends.
export default function NoteView({ lecture: initial, parts: initialParts, courses, gemini }: {
  lecture: Lecture;
  parts: NotePart[]; // notes written so far, part by part, while the class recorded
  courses: string[];
  gemini: boolean;
}) {
  const router = useRouter();
  const [lecture, setLecture] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(noteDay(initial));
  const [writing, setWriting] = useState(false);
  const [parts, setParts] = useState(initialParts);
  const [partAt, setPartAt] = useState<NoteWindow | null>(null); // the stretch of class being written up now
  const [err, setErr] = useState("");
  const [live, setLive] = useState(false);
  const [finishing, setFinishing] = useState(false); // after Stop, the last minutes are still being sent
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
  // The writing below runs across many renders, so it reads the latest lecture and parts from refs.
  const now = useRef({ lecture, parts });
  now.current = { lecture, parts };
  const partsJob = useRef<Promise<void>>(Promise.resolve());
  const partsBusy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  // A title Pace picked can be replaced by a better pick; one you typed never is.
  const autoTitle = useRef(!!initial.titleAuto || !initial.title.trim());
  const askedTitle = useRef(false);

  const code = lecture.courseCode;
  const byId = useMemo(() => new Map(lecture.segments.map((s) => [s.id, s])), [lecture.segments]);
  const notes = lecture.notes;
  const hasTranscript = lecture.segments.length > 0;
  const checked = new Set(lecture.checked ?? []);
  // While the class records, or until its notes are finished, the parts written so far show instead.
  const draft = useMemo(() => (parts.length ? draftNotes(parts) : null), [parts]);
  const shown = (live || !notes) && draft ? draft : notes;
  const stale = shown === notes && notes && lecture.segments.length > notes.segmentCount ? lecture.segments.length - notes.segmentCount : 0;

  // Which notes cite each transcript line, so hovering the transcript lights up the notes.
  const citedBy = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const { key, sources } of allLines(shown)) for (const id of sources) (m.get(id) ?? m.set(id, new Set()).get(id)!).add(key);
    return m;
  }, [shown]);
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

  // A title picked from the content fills an empty title or replaces an earlier pick, but never
  // one you typed, and never while you're typing in the title.
  const offerTitle = useCallback((next: string) => {
    if (next && autoTitle.current && document.activeElement !== titleBox.current) setTitle(next);
  }, []);

  // Writes notes for each finished 10 minutes of class that has none yet, one at a time. It runs
  // after every new minute of transcript while the class records, and catches up before the
  // notes are finished. reset starts over.
  const runParts = useCallback(
    (reset = false) =>
      (partsJob.current = partsJob.current.then(async () => {
        partsBusy.current = true;
        let first = reset;
        while (alive.current) {
          const next = nextWindow(now.current.lecture.segments, first ? [] : now.current.parts);
          if (!next) break;
          setPartAt(next);
          const res = await fetch(`/api/lectures/${lecture.id}/parts`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reset: first }),
          }).catch(() => null);
          const out = await res?.json().catch(() => null);
          if (!res?.ok || !out?.parts) break; // finishing the notes picks up whatever is left
          first = false;
          now.current.parts = out.parts;
          setParts(out.parts);
          offerTitle(out.title ?? "");
          if (!out.written) break;
        }
        setPartAt(null);
        partsBusy.current = false;
      })),
    [lecture.id, offerTitle],
  );

  useEffect(() => {
    if ((live || finishing) && gemini && !partsBusy.current && nextWindow(lecture.segments, parts)) void runParts();
  }, [live, finishing, gemini, lecture.segments, parts, runParts]);

  const writeNotes = useCallback(
    async (fresh = false) => {
      setWriting(true);
      setErr("");
      // Your notes steer the class notes, so save what was just typed first.
      await flush();
      await queue(async () => undefined); // let any save still on its way land first
      // A long class is written up in parts, most of them while it recorded.
      const long = span(now.current.lecture.segments) > ONE_GO_SECONDS;
      if (gemini && (long || (!fresh && now.current.parts.length))) {
        if (fresh) {
          now.current.parts = [];
          setParts([]);
        }
        await runParts(fresh);
      }
      const res = await fetch(`/api/lectures/${lecture.id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fresh: fresh && !long }),
      }).catch(() => null);
      const out = await res?.json().catch(() => ({}));
      setWriting(false);
      if (!res?.ok) return setErr(out?.error ?? "Couldn't write the notes. Try again.");
      setLecture((l) => ({ ...l, notes: out.notes as LectureNotes }));
      now.current.parts = out.parts ?? [];
      setParts(now.current.parts);
      if (out.titleAuto) offerTitle(out.title);
    },
    [lecture.id, queue, flush, gemini, runParts, offerTitle],
  );

  const onFinished = useCallback(() => {
    refreshAudio();
    void writeNotes();
  }, [refreshAudio, writeNotes]);

  // An untitled note gets a title from what's on it once there's enough to go on: a few lines of
  // your notes, or notes from its recording. A class being recorded gets one when its notes are done.
  useEffect(() => {
    if (title.trim() || !autoTitle.current || askedTitle.current || live || finishing || writing || saveState === "saving") return;
    const enough = hasTranscript ? lecture.segments === initial.segments && (!!lecture.notes || parts.length > 0) : wordCount(mine) >= 12;
    if (!enough) return;
    const t = setTimeout(async () => {
      askedTitle.current = true;
      const res = await fetch(`/api/lectures/${lecture.id}/title`, { method: "POST" }).catch(() => null);
      const out = await res?.json().catch(() => null);
      if (res?.ok && out?.titleAuto) offerTitle(out.title);
    }, 1500);
    return () => clearTimeout(t);
  }, [title, mine, live, finishing, writing, saveState, hasTranscript, lecture.segments, lecture.notes, parts.length, initial.segments, lecture.id, offerTitle]);

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
      await navigator.clipboard.writeText(markdown({ ...lecture, title, date, myNotes: mine }, shown, byId));
    } catch {
      return (setMenu(false), setErr("Couldn't copy. Your browser blocked the clipboard."));
    }
    setCopied(true);
    setTimeout(() => (setCopied(false), setMenu(false)), 1200);
  };

  const line = (key: string, l: SourcedLine, tag?: React.ReactNode) => {
    const first = byId.get(l.sources[0]);
    return (
      <span data-note={key} {...bind(key, l)} className={`src ${hover?.key === key ? "on" : ""} ${litNotes?.has(key) ? "lit" : ""} ${flash === key ? "flash" : ""}`}>
        {inline(l.text)}
        {tag}
        {first && <span className="src-tag">{clock(first.start)}</span>}
      </span>
    );
  };

  const others = [...new Set([code, ...courses])].filter((c) => c !== code);
  const long = span(lecture.segments) > ONE_GO_SECONDS;
  const writingNow = partAt ? `Writing notes for ${clock(partAt.from)}–${clock(partAt.to)}…` : "";

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
                    {hasTranscript && !live && <button type="button" role="menuitem" disabled={writing || finishing} onClick={() => (setMenu(false), writeNotes(!!notes))}>{notes ? "Rewrite class notes" : "Write class notes"}</button>}
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
            autoTitle.current = !next.trim(); // yours now, unless you cleared it
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
          onBusy={setFinishing}
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
              <span>
                From the class recording{lecture.duration > 0 ? ` · ${clock(lecture.duration)}` : ""}
                {shown && shown === draft ? " · notes so far" : notes ? (notes.ai ? " · written by Gemini" : " · picked from the transcript") : ""}
              </span>
            </div>
            {live ? (
              <p className={`doc-hint ${writingNow ? "busy" : ""}`}>
                {!gemini ? (
                  "Recording. Keep writing your notes above. When you stop, notes from the transcript appear here, and yours decide what they focus on."
                ) : writingNow ? (
                  <>
                    <span className="rec-spin" aria-hidden /> {writingNow}
                  </>
                ) : draft ? (
                  "Recording. These notes grow with every 10 minutes of class. When you stop, they're finished with a summary, the key takeaways and questions to test yourself."
                ) : (
                  "Recording. Notes for every 10 minutes of class appear here while it goes on. Keep writing yours above: they steer what the notes focus on."
                )}
              </p>
            ) : writing || finishing ? (
              <div className="callout">
                <span className="callout-ico" aria-hidden>✦</span>
                <div>
                  <strong>
                    {writingNow || (finishing ? "Transcribing the last minute…" : parts.length || long ? "Putting your notes together…" : "Writing notes from the transcript…")}
                  </strong>
                  <div className="doc-shimmer"><i /><i /><i /></div>
                </div>
              </div>
            ) : !notes ? (
              <div className="callout">
                <span className="callout-ico" aria-hidden>✦</span>
                <div>
                  <strong>{draft ? "Notes from the class so far" : `${lecture.segments.length} transcript lines, ready for notes`}</strong>
                  <p>{draft ? "Finish them to add a summary, the key takeaways and questions to test yourself." : "Every line will link back to the words it came from."}</p>
                  <button type="button" className="doc-btn" onClick={() => writeNotes()}>
                    {gemini ? (draft ? "✦ Finish class notes" : "✦ Write class notes") : "Write class notes"}
                  </button>
                </div>
              </div>
            ) : stale > 0 ? (
              <div className="callout soft">
                <span className="callout-ico" aria-hidden>↻</span>
                <div>
                  {stale} new transcript line{stale === 1 ? "" : "s"} since these notes were written.{" "}
                  <button type="button" className="inline-link" onClick={() => writeNotes()}>Update</button>
                </div>
              </div>
            ) : null}

            {shown && <ClassNotes notes={shown} line={line} checked={checked} onCheck={toggle} />}

            {shown && !live && (
              <p className="doc-foot">
                Hover any line to see the words it came from.
                {shown.dropped > 0 && ` ${shown.dropped} line${shown.dropped === 1 ? "" : "s"} with no source in the transcript ${shown.dropped === 1 ? "was" : "were"} left out.`}
              </p>
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

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

// The note as Markdown, for pasting into another app.
function markdown(l: Lecture, n: LectureNotes | null, byId: Map<string, Segment>): string {
  const at = (s: string[]) => {
    const seg = byId.get(s[0]);
    return seg ? ` [${clock(seg.start)}]` : "";
  };
  const exam = (p: NotePoint) => (p.exam ? " (exam)" : "");
  const point = (p: NotePoint, mark: string) => [`${mark} ${p.text}${exam(p)}${at(p.sources)}`, ...(p.sub ?? []).map((c) => `   - ${c.text}${at(c.sources)}`)];
  const cell = (text: string) => text.replace(/\|/g, "\\|");
  const done = new Set(l.checked ?? []);
  const takeaways = n?.takeaways ?? [];
  const questions = n?.questions ?? [];
  return [
    `# ${l.courseCode}: ${noteTitle(l)}`,
    formatDate(noteDay(l), true),
    ...(l.myNotes?.trim() ? ["", l.myNotes.trim()] : []),
    ...(n
      ? [
          "",
          "## From the class recording",
          ...(n.summary.length ? ["", `> **In short:** ${n.summary.map((x) => x.text).join(" ")}`] : []),
          ...(takeaways.length ? ["", "### Key takeaways", ...takeaways.flatMap((p, i) => point(p, `${i + 1}.`))] : []),
          ...(n.actions.length ? ["", "### To do", ...n.actions.map((x) => `- [${done.has(x.text) ? "x" : " "}] ${x.text}${at(x.sources)}`)] : []),
          ...n.sections.flatMap((s) => ["", `### ${s.heading}`, ...s.bullets.flatMap((b) => point(b, "-"))]),
          ...(n.terms.length ? ["", "### Key terms", "", "| Term | What it means |", "| --- | --- |", ...n.terms.map((t) => `| ${cell(t.term)} | ${cell(t.definition)}${at(t.sources)} |`)] : []),
          ...(questions.length ? ["", "### Check yourself", ...questions.flatMap((q, i) => [`${i + 1}. ${q.question}`, `   - ${q.answer}${at(q.sources)}`])] : []),
        ]
      : []),
  ].join("\n");
}
