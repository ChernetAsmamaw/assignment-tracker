"use client";

import Link from "next/link";
import { useRef, useState } from "react";

// The hover card behind every note: it shows the exact transcript lines a note came from.

export interface Quote {
  key: string;
  time: string; // "12:03" into the class
  text: string;
  label?: string; // which class, on pages that span several
  href?: string; // open that class's notes at this line
  onPlay?: () => void; // play the recording from here, when the audio is on this device
  playing?: boolean;
}

export interface Hover<T> {
  key: string;
  data: T;
  x: number;
  y: number;
  above: boolean;
}

export function useHoverCard<T>() {
  const [hover, setHover] = useState<Hover<T> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = (key: string, data: T, el: HTMLElement) => {
    clearTimeout(timer.current);
    const r = el.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    const above = r.bottom > window.innerHeight * 0.62;
    setHover({ key, data, x: Math.min(Math.max(12, r.left), window.innerWidth - width - 12), y: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(null), 180);
  };
  const keep = () => clearTimeout(timer.current);

  // Spread onto anything whose source can be shown: hover, keyboard focus or a tap opens the card.
  const bind = (key: string, data: T) => ({
    tabIndex: 0,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(key, data, e.currentTarget),
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(key, data, e.currentTarget),
    onBlur: hide,
    onClick: (e: React.MouseEvent<HTMLElement>) => show(key, data, e.currentTarget),
  });

  return { hover, bind, keep, hide, close: () => setHover(null) };
}

export function SourceCard<T>({ hover, quotes, note, onEnter, onLeave, footer }: {
  hover: Hover<T>;
  quotes: Quote[];
  note: string; // the note's own text, to mark the words the quote shares with it
  onEnter: () => void;
  onLeave: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className={`src-card ${hover.above ? "above" : ""}`} style={{ left: hover.x, top: hover.y }} onMouseEnter={onEnter} onMouseLeave={onLeave} role="dialog" aria-label="Where this came from">
      <div className="src-card-head">From the transcript</div>
      {quotes.length === 0 && <p className="src-none">Not covered in your class notes yet.</p>}
      {quotes.map((q, i) => (
        <div key={q.key} className="src-quote">
          {q.onPlay ? (
            <button type="button" className="src-time play" onClick={q.onPlay} title="Play from here">{q.playing ? "❚❚" : `▶ ${q.time}`}</button>
          ) : q.href ? (
            <Link href={q.href} className="src-time" title="Open the class at this line">{q.time}</Link>
          ) : (
            <span className="src-time">{q.time}</span>
          )}
          <div>
            {q.label && q.label !== quotes[i - 1]?.label && <div className="src-label">{q.href ? <Link href={q.href}>{q.label}</Link> : q.label}</div>}
            <q>{mark(q.text, note)}</q>
          </div>
        </div>
      ))}
      {footer}
    </div>
  );
}

// Marks the words in a quote that also appear in the note, so it's clear what supports what.
const COMMON = new Set("the and that this with from they them then than have what when which were will would there their about into your just like okay".split(" "));

function mark(quote: string, note: string) {
  const words = new Set((note.toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) ?? []).filter((w) => !COMMON.has(w)));
  return quote.split(/(\s+)/).map((w, i) => {
    const bare = w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    return bare.length > 3 && words.has(bare) ? <mark key={i}>{w}</mark> : w;
  });
}
