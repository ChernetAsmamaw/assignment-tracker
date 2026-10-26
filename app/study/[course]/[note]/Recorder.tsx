"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { saveChunk, wavBlob } from "@/lib/audio-store";
import { clock, type Segment } from "@/lib/lectures";

const RATE = 16000;
const CHUNK_SECONDS = 60; // one upload and one transcription per minute of class

interface Job {
  offset: number;
  length: number;
  blob: Blob;
  captions: string;
  tries: number;
}

type Status = "idle" | "recording" | "paused" | "finishing";

// Minimal typing for the Web Speech API, which TypeScript's DOM lib doesn't include.
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

export interface RecorderHandle {
  start: () => void;
}

// Records in the background of the notes page. Before anything is recorded it shows a block
// that invites you to start; while recording it's a small floating bar, like Granola's.
export default function Recorder({
  ref,
  lectureId,
  offset,
  gemini,
  inline,
  extra,
  onLive,
  onSegments,
  onFinished,
}: {
  ref?: React.Ref<RecorderHandle>;
  lectureId: string;
  offset: number; // where this recording starts in the lecture (seconds already recorded)
  gemini: boolean;
  inline: boolean; // show the "record this class" block (nothing recorded yet)
  extra?: React.ReactNode; // shown under the start button in that block
  onLive: (live: boolean) => void;
  onSegments: (segments: Segment[], duration: number) => void;
  onFinished: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [captionsOn, setCaptionsOn] = useState(true);

  const r = useRef({
    ctx: null as AudioContext | null,
    stream: null as MediaStream | null,
    proc: null as ScriptProcessorNode | null,
    recog: null as Recognition | null,
    wake: null as { release(): Promise<void> } | null,
    pieces: [] as Int16Array[],
    chunkSamples: 0,
    total: 0,
    start: 0,
    carry: 0,
    paused: false,
    live: false,
    captions: [] as { t: number; text: string }[],
    queue: [] as Job[],
    working: false,
    finishing: false,
  });

  // The audio callbacks are created once per recording, so they reach the latest props through a ref.
  const cb = useRef({ onSegments, onFinished, onLive });
  cb.current = { onSegments, onFinished, onLive };
  useImperativeHandle(ref, () => ({ start: () => void start() }));

  const now = () => r.current.start + r.current.total / RATE;

  // Warn before closing the tab mid-class.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (r.current.live || r.current.queue.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError("");
    const s = r.current;
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the address bar, then try again." : "Couldn't open a microphone on this device.");
      return;
    }
    Object.assign(s, { start: offset, total: 0, chunkSamples: 0, pieces: [], carry: 0, paused: false, live: true, captions: [], finishing: false });
    s.ctx = new AudioContext();
    const source = s.ctx.createMediaStreamSource(s.stream);
    s.proc = s.ctx.createScriptProcessor(4096, 1, 1);
    s.proc.onaudioprocess = (e) => capture(e.inputBuffer.getChannelData(0), s.ctx!.sampleRate);
    source.connect(s.proc);
    s.proc.connect(s.ctx.destination); // the processor only runs while connected; it outputs silence
    startCaptions();
    try {
      s.wake = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null;
    } catch {}
    setStatus("recording");
    cb.current.onLive(true);
  }

  // Downsample the mic to 16 kHz mono and cut a chunk every minute.
  function capture(input: Float32Array, rate: number) {
    const s = r.current;
    if (s.paused || !s.live) return;
    const ratio = rate / RATE;
    const out = new Int16Array(Math.ceil((input.length - s.carry) / ratio));
    let pos = s.carry;
    let n = 0;
    let sq = 0;
    while (pos < input.length && n < out.length) {
      const i0 = Math.floor(pos);
      const i1 = Math.max(i0 + 1, Math.min(input.length, Math.floor(pos + ratio)));
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += input[i];
      const v = Math.max(-1, Math.min(1, sum / (i1 - i0)));
      sq += v * v;
      out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      pos += ratio;
    }
    s.carry = pos - input.length;
    s.pieces.push(out.subarray(0, n));
    s.chunkSamples += n;
    s.total += n;
    setElapsed(s.total / RATE);
    setLevel(Math.min(1, Math.sqrt(sq / Math.max(1, n)) * 4));
    if (s.chunkSamples >= CHUNK_SECONDS * RATE) cut();
  }

  function cut() {
    const s = r.current;
    const length = s.chunkSamples / RATE;
    const offsetSec = now() - length;
    const samples = new Int16Array(s.chunkSamples);
    let at = 0;
    for (const p of s.pieces) (samples.set(p, at), (at += p.length));
    s.pieces = [];
    s.chunkSamples = 0;
    if (length < 1) return;
    const captions = s.captions.filter((c) => c.t >= offsetSec && c.t < offsetSec + length).map((c) => c.text).join(" ");
    s.captions = s.captions.filter((c) => c.t >= offsetSec + length);
    const blob = wavBlob(samples, RATE);
    void saveChunk({ lectureId, offset: offsetSec, length, blob });
    s.queue.push({ offset: offsetSec, length, blob, captions, tries: 0 });
    setPending(s.queue.length);
    void work();
  }

  // Upload chunks one at a time, in order, retrying a few times on a bad connection.
  async function work() {
    const s = r.current;
    if (s.working) return;
    s.working = true;
    setFailed(false);
    while (s.queue.length) {
      const job = s.queue[0];
      try {
        const res = await fetch(`/api/lectures/${lectureId}/chunk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audio: await base64(job.blob), mimeType: "audio/wav", offset: job.offset, length: job.length, captions: job.captions }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { segments: Segment[]; duration: number };
        s.queue.shift();
        setPending(s.queue.length);
        cb.current.onSegments(body.segments, body.duration);
      } catch {
        job.tries++;
        if (job.tries >= 4) {
          setFailed(true);
          s.working = false;
          return;
        }
        await new Promise((ok) => setTimeout(ok, 2000 * 2 ** job.tries));
      }
    }
    s.working = false;
    if (s.finishing) {
      s.finishing = false;
      setStatus("idle");
      cb.current.onFinished();
    }
  }

  function retry() {
    for (const j of r.current.queue) j.tries = 0;
    void work();
  }

  function startCaptions() {
    const s = r.current;
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Impl = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Impl) return setCaptionsOn(false);
    const rec = new Impl();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-CA";
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) s.captions.push({ t: now(), text: res[0].transcript.trim() });
        else text += res[0].transcript;
      }
      setInterim(text.trim() || (s.captions.at(-1)?.text ?? ""));
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") (s.recog = null, setCaptionsOn(false));
    };
    // Recognition stops by itself after a pause in speech; keep it going for the whole class.
    rec.onend = () => {
      if (s.live && !s.paused && s.recog === rec) setTimeout(() => s.recog === rec && s.live && !s.paused && safe(() => rec.start()), 250);
    };
    s.recog = rec;
    safe(() => rec.start());
  }

  function pause() {
    const s = r.current;
    s.paused = !s.paused;
    setStatus(s.paused ? "paused" : "recording");
    if (s.paused) safe(() => s.recog?.stop());
    else safe(() => s.recog?.start());
  }

  function stop() {
    const s = r.current;
    s.paused = false;
    cut();
    s.live = false;
    teardown();
    setInterim("");
    setLevel(0);
    cb.current.onLive(false);
    if (s.queue.length) {
      s.finishing = true;
      setStatus("finishing");
    } else {
      setStatus("idle");
      cb.current.onFinished();
    }
  }

  function teardown() {
    const s = r.current;
    const recog = s.recog;
    s.recog = null;
    safe(() => recog?.stop());
    s.proc?.disconnect();
    s.stream?.getTracks().forEach((t) => t.stop());
    void s.ctx?.close().catch(() => {});
    void s.wake?.release().catch(() => {});
    Object.assign(s, { proc: null, stream: null, ctx: null, wake: null });
  }

  const live = status === "recording" || status === "paused";
  const how = gemini
    ? "Put your laptop or phone near the speaker. Each minute is transcribed while class goes on, and type your own notes below if you like."
    : captionsOn
      ? "Transcribed with your browser's live captions. Add a Gemini key for a more accurate transcript."
      : "This browser has no live captions and there's no Gemini key, so nothing can be transcribed. Paste a transcript instead.";

  if (!live && status !== "finishing" && !failed) {
    if (!inline)
      return error ? (
        <div className="rec-dock">
          <div className="rec-pill" role="alert">
            <span className="rec-sub">{error}</span>
            <button type="button" onClick={() => setError("")}>OK</button>
          </div>
        </div>
      ) : null;
    return (
      <div className="callout rec-start">
        <span className="callout-ico" aria-hidden>🎙️</span>
        <div>
          <strong>Record this class</strong>
          <p>{how}</p>
          <div className="rec-start-row">
            <button type="button" className="rec-go" onClick={start}><span className="rec-dot" /> Start recording</button>
            {extra}
          </div>
          {error && <p className="doc-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="rec-dock" role="region" aria-label="Recording">
      {live && captionsOn && <div className="rec-caption">{interim || <span className="faint">Listening…</span>}</div>}
      <div className={`rec-pill ${status}`}>
        {live ? (
          <>
            <span className={`rec-dot ${status === "recording" ? "pulse" : ""}`} aria-hidden />
            <span className="rec-time">{clock(offset + elapsed)}</span>
            <span className="rec-level" aria-hidden>
              {Array.from({ length: 10 }, (_, i) => <i key={i} className={level * 10 > i ? "on" : ""} />)}
            </span>
            <span className="rec-sub">{status === "paused" ? "Paused" : failed ? "Upload stalled" : pending ? "Transcribing…" : "Recording"}</span>
            {failed && <button type="button" onClick={retry}>Retry upload</button>}
            <button type="button" onClick={pause}>{status === "paused" ? "Resume" : "Pause"}</button>
            <button type="button" className="rec-stop" onClick={stop}><span className="rec-square" aria-hidden /> Stop</button>
          </>
        ) : failed ? (
          <>
            <span className="rec-sub">{pending} minute{pending === 1 ? "" : "s"} couldn&apos;t upload. The audio is safe on this device.</span>
            <button type="button" onClick={retry}>Try again</button>
          </>
        ) : (
          <>
            <span className="rec-spin" aria-hidden />
            <span className="rec-sub">Transcribing the last {pending > 1 ? `${pending} minutes` : "minute"}, then writing your notes…</span>
          </>
        )}
      </div>
    </div>
  );
}

function safe(f: () => void) {
  try {
    f();
  } catch {}
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
