"use client";

import { ask } from "./Shell";

const CHIPS = ["I'm busy Tuesday evening", "Open my CSC263 notes", "Quiz me on my weakest topic", "What should I do first today?"];

export default function AskHero() {
  return (
    <div>
      <button type="button" className="ask-hero" onClick={() => ask()}>
        <span className="spark" style={{ fontSize: 20 }}>✦</span> Tell Pace what&apos;s going on, or ask for a plan…
        <kbd style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>⌘K</kbd>
      </button>
      <div className="chips">
        {CHIPS.map((c) => <button key={c} type="button" onClick={() => ask(c)}>{c}</button>)}
      </div>
    </div>
  );
}
