"use client";

import { useEffect } from "react";
import { useRecording } from "@/lib/recording";

// When a page fails, only that page is replaced: the sidebar and the recorder stay, so a class
// being recorded carries on.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const rec = useRecording();
  const recording = rec.status === "recording" || rec.status === "paused";
  useEffect(() => console.error(error), [error]);
  return (
    <header className="page-head">
      <div>
        <h1>This page didn&apos;t load</h1>
        <p>
          Something went wrong on our side. Try again, or open another page from the sidebar.
          {recording && " Your recording is still going."}
        </p>
        <button type="button" className="primary" style={{ marginTop: 14 }} onClick={reset}>
          Try again
        </button>
      </div>
    </header>
  );
}
