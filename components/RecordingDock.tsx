"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clock, type Segment } from "@/lib/lectures";
import { recording, useMeter, useRecording, type Meter } from "@/lib/recording";

// The recorder floats over every page while a class records, so you can open the rest of Pace
// without stopping it, and links back to the note. Its transcript opens above it to show what's
// being transcribed as the class goes on.
export default function RecordingDock() {
  const s = useRecording();
  const m = useMeter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const here = !!s.id && path.startsWith("/study/") && path.split("/").at(-1) === s.id; // on the note being recorded
  const live = s.status === "recording" || s.status === "paused";

  if (s.status === "idle")
    return s.error ? (
      <div className="rec-dock">
        <div className="rec-pill" role="alert">
          <span className="rec-sub rec-msg">{s.error}</span>
          <button type="button" onClick={() => recording.clear()}>OK</button>
        </div>
      </div>
    ) : null;

  // The note shows its own progress and picks up its notes.
  if (here && (s.status === "writing" || s.status === "done")) return null;

  const back = !here && (
    <Link href={s.href} className="rec-back" title="Back to the note">
      {s.name}
    </Link>
  );

  if (s.status === "done")
    return (
      <div className="rec-dock">
        <div className="rec-pill" role="status">
          <span className="rec-sub rec-msg">{s.failed || "Your class notes are ready:"}</span>
          {back}
          <button type="button" onClick={() => recording.clear()} aria-label="Dismiss">×</button>
        </div>
      </div>
    );

  const toggle = (
    <button type="button" className={open ? "on" : ""} onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide the transcript" : "Show what's being transcribed"}>
      Transcript <span aria-hidden>{open ? "▾" : "▴"}</span>
    </button>
  );

  return (
    <div className="rec-dock" role="region" aria-label="Recording">
      {s.error && <div className="rec-note" role="alert">{s.error}</div>}
      {open && s.status !== "writing" ? (
        <LiveTranscript lines={s.segments.filter((x) => x.start >= s.base)} meter={m} captions={s.captions} onClose={() => setOpen(false)} />
      ) : (
        live && s.captions && <div className="rec-caption">{m.now || m.heard.at(-1)?.text || <span className="faint">Listening…</span>}</div>
      )}
      <div className={`rec-pill ${s.status}`}>
        {live ? (
          <>
            <span className={`rec-dot ${s.status === "recording" ? "pulse" : ""}`} aria-hidden />
            <span className="rec-time">{clock(s.base + m.elapsed)}</span>
            <span className="rec-level" aria-hidden>
              {Array.from({ length: 10 }, (_, i) => <i key={i} className={m.level * 10 > i ? "on" : ""} />)}
            </span>
            <span className="rec-sub">{s.status === "paused" ? "Paused" : s.stalled ? "Upload stalled" : s.pending ? "Transcribing…" : "Recording"}</span>
            {back}
            {s.stalled && <button type="button" onClick={() => recording.retry()}>Retry upload</button>}
            {toggle}
            <button type="button" onClick={() => recording.pause()} aria-label={s.status === "paused" ? "Resume" : "Pause"}>
              <span className="rec-word">{s.status === "paused" ? "Resume" : "Pause"}</span>
              <span className="rec-ico" aria-hidden>{s.status === "paused" ? "▶\uFE0E" : "❚❚"}</span>
            </button>
            <button type="button" className="rec-stop" onClick={() => recording.stop()}><span className="rec-square" aria-hidden /> Stop</button>
          </>
        ) : s.stalled ? (
          <>
            <span className="rec-sub rec-msg">{s.pending} minute{s.pending === 1 ? "" : "s"} couldn&apos;t upload. The audio is safe on this device.</span>
            <button type="button" onClick={() => recording.retry()}>Try again</button>
            <button type="button" onClick={() => recording.skipUnsent()}>Write notes without {s.pending === 1 ? "it" : "them"}</button>
          </>
        ) : (
          <>
            <span className="rec-spin" aria-hidden />
            <span className="rec-sub rec-msg">
              {s.status === "finishing"
                ? `Transcribing the last ${s.pending > 1 ? `${s.pending} minutes` : "minute"}…`
                : s.writing
                  ? `Writing notes for ${clock(s.writing.from)}–${clock(s.writing.to)}…`
                  : "Writing your class notes…"}
            </span>
            {back}
            {s.status === "finishing" && toggle}
          </>
        )}
      </div>
    </div>
  );
}

// What's been transcribed this recording, newest at the bottom. Each minute is transcribed about a
// minute after it's said; the browser's own captions (in gray) fill in what's being said now.
function LiveTranscript({ lines, meter, captions, onClose }: { lines: Segment[]; meter: Meter; captions: boolean; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true); // follow new lines, unless you've scrolled up to read
  const shown = lines.slice(-400);
  useEffect(() => {
    const el = box.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, meter.heard.length, meter.now]);
  const empty = !shown.length && !meter.heard.length && !meter.now;
  return (
    <div className="rec-live" role="log" aria-label="Live transcript">
      <div className="rec-live-head">
        <strong>Live transcript</strong>
        <span>{captions ? "Gray is what's being heard now" : "Each minute appears about a minute later"}</span>
        <button type="button" onClick={onClose} aria-label="Collapse the transcript">▾</button>
      </div>
      <div
        className="rec-live-body"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.map((x) => (
          <p key={x.id}>
            <span className="t">{clock(x.start)}</span>
            {x.text}
          </p>
        ))}
        {meter.heard.map((c, i) => (
          <p key={`h${i}`} className="heard">
            <span className="t">{clock(c.t)}</span>
            {c.text}
          </p>
        ))}
        {meter.now && (
          <p className="heard">
            <span className="t">now</span>
            {meter.now}
          </p>
        )}
        {empty && <p className="rec-live-empty">The transcript shows here as the class goes on, a minute at a time.</p>}
      </div>
    </div>
  );
}
