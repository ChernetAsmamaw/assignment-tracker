import { useSyncExternalStore } from "react";
import { saveChunk, wavBlob } from "./audio-store";
import { nextWindow, span, ONE_GO_SECONDS, type LectureNotes, type NotePart, type NoteWindow, type Segment } from "./lectures";

// A class recording runs here, outside any page, so it keeps going while you open other pages of
// Pace: the recorder (components/RecordingDock) floats over every page, and the note shows what's
// been written when you go back to it. Audio is cut into one-minute chunks that are sent in order
// to be transcribed, notes for every finished 10 minutes are written while the class goes on, and
// after Stop the notes are finished whichever page is open.

const RATE = 16000;
const CHUNK_SECONDS = 60; // one upload and one transcription per minute of class
const METER_MS = 250; // how often the clock and the level redraw

// finishing: stopped, the last minutes are still being sent. writing: the notes are being finished.
// done: they're written, or couldn't be (failed says why), and the note's page hasn't shown them yet.
export type RecStatus = "idle" | "recording" | "paused" | "finishing" | "writing" | "done";

export interface Finished {
  notes: LectureNotes;
  title: string;
  titleAuto: boolean;
  parts: NotePart[];
}

export interface RecState {
  id: string | null; // the note being recorded
  href: string; // its page
  name: string; // its title, for the recorder on other pages
  status: RecStatus;
  base: number; // seconds of class the note had before this recording started
  segments: Segment[]; // the note's whole transcript, as it comes in
  duration: number;
  parts: NotePart[]; // notes written so far, part by part
  writing: NoteWindow | null; // the stretch of class being written up now
  title: string; // a title from the notes so far, shown until the notes are finished
  pending: number; // minutes waiting to be sent
  stalled: boolean; // sending failed a few times; the audio is safe on this device
  captions: boolean; // the browser is captioning what it hears
  error: string; // why recording couldn't start, or stopped early
  done: Finished | null;
  failed: string; // why the notes couldn't be written
}

// What changes many times a second, kept apart so the note's page doesn't redraw with it.
export interface Meter {
  elapsed: number; // seconds recorded this time
  level: number; // 0 to 1
  heard: { t: number; text: string }[]; // the browser's captions of what isn't in the transcript yet
  now: string; // what it's hearing this moment
}

interface Job {
  offset: number;
  length: number;
  blob: Blob;
  captions: string;
  tries: number;
}

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

const IDLE: RecState = {
  id: null,
  href: "",
  name: "",
  status: "idle",
  base: 0,
  segments: [],
  duration: 0,
  parts: [],
  writing: null,
  title: "",
  pending: 0,
  stalled: false,
  captions: false,
  error: "",
  done: null,
  failed: "",
};
const QUIET: Meter = { elapsed: 0, level: 0, heard: [], now: "" };
const ACTIVE: RecStatus[] = ["recording", "paused", "finishing", "writing"];
const JSON_HEADERS = { "content-type": "application/json" };

// One recording's audio and uploads.
const fresh = () => ({
  ctx: null as AudioContext | null,
  stream: null as MediaStream | null,
  proc: null as ScriptProcessorNode | null,
  recog: null as Recognition | null,
  wake: null as { release(): Promise<void> } | null,
  pieces: [] as Int16Array[],
  chunkSamples: 0,
  total: 0,
  carry: 0,
  peak: 0,
  drawn: 0,
  captions: [] as { t: number; text: string }[], // sent with each minute, for when there's no Gemini
  queue: [] as Job[],
  sending: false,
  gemini: false,
});

class Recorder {
  state = IDLE;
  meter = QUIET;
  private a = fresh();
  private starting = false;
  private seen = new Set<() => void>();
  private ticks = new Set<() => void>();
  private partsJob: Promise<void> = Promise.resolve();
  private partsQueued = false;
  private flushers = new Map<string, () => Promise<void>>();

  subscribe = (f: () => void) => {
    this.seen.add(f);
    return () => void this.seen.delete(f);
  };
  subscribeMeter = (f: () => void) => {
    this.ticks.add(f);
    return () => void this.ticks.delete(f);
  };

  private set(patch: Partial<RecState>) {
    this.state = { ...this.state, ...patch };
    for (const f of this.seen) f();
  }
  private draw(patch: Partial<Meter>) {
    this.meter = { ...this.meter, ...patch };
    for (const f of this.ticks) f();
  }

  get live() {
    return this.state.status === "recording" || this.state.status === "paused";
  }
  // Seconds into the class.
  private now() {
    return this.state.base + this.a.total / RATE;
  }

  async start(o: { id: string; href: string; name: string; base: number; segments: Segment[]; parts: NotePart[]; gemini: boolean }) {
    if (this.starting || ACTIVE.includes(this.state.status)) return; // one class at a time
    if (!o.gemini && !speech())
      return this.set({
        ...IDLE,
        error: "This browser has no live captions and there's no Gemini key, so nothing can be transcribed. Paste a transcript from the ⋯ menu instead.",
      });
    this.starting = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      return this.set({
        ...IDLE,
        error: (e as Error).name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the address bar, then try again." : "Couldn't open a microphone on this device.",
      });
    } finally {
      this.starting = false;
    }
    const a = (this.a = { ...fresh(), stream, gemini: o.gemini });
    const ctx = (a.ctx = new AudioContext());
    const source = ctx.createMediaStreamSource(stream);
    a.proc = ctx.createScriptProcessor(4096, 1, 1);
    a.proc.onaudioprocess = (e) => this.capture(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    source.connect(a.proc);
    a.proc.connect(ctx.destination); // the processor only runs while connected; it outputs silence
    stream.getAudioTracks()[0]?.addEventListener("ended", this.micLost);
    this.draw(QUIET);
    this.set({ ...IDLE, id: o.id, href: o.href, name: o.name, status: "recording", base: o.base, segments: o.segments, duration: o.base, parts: o.parts });
    this.listen(true);
    this.startCaptions();
    void this.keepAwake();
  }

  // Downsamples the mic to 16 kHz mono and cuts a chunk every minute.
  private capture(input: Float32Array, rate: number) {
    const a = this.a;
    if (this.state.status !== "recording") return;
    const ratio = rate / RATE;
    const out = new Int16Array(Math.ceil((input.length - a.carry) / ratio));
    let pos = a.carry;
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
    a.carry = pos - input.length;
    a.pieces.push(out.subarray(0, n));
    a.chunkSamples += n;
    a.total += n;
    a.peak = Math.max(a.peak, Math.min(1, Math.sqrt(sq / Math.max(1, n)) * 4));
    const t = performance.now();
    if (t - a.drawn >= METER_MS) {
      a.drawn = t;
      this.draw({ elapsed: a.total / RATE, level: a.peak });
      a.peak = 0;
    }
    if (a.chunkSamples >= CHUNK_SECONDS * RATE) this.cut();
  }

  private cut() {
    const a = this.a;
    const length = a.chunkSamples / RATE;
    const offset = this.now() - length;
    const samples = new Int16Array(a.chunkSamples);
    let at = 0;
    for (const p of a.pieces) (samples.set(p, at), (at += p.length));
    a.pieces = [];
    a.chunkSamples = 0;
    if (length < 1) return;
    const captions = a.captions.filter((c) => c.t >= offset && c.t < offset + length).map((c) => c.text).join(" ");
    a.captions = a.captions.filter((c) => c.t >= offset + length);
    const blob = wavBlob(samples, RATE);
    void saveChunk({ lectureId: this.state.id!, offset, length, blob });
    a.queue.push({ offset, length, blob, captions, tries: 0 });
    this.set({ pending: a.queue.length });
    void this.send();
  }

  // Sends the chunks one at a time, in order, retrying a few times on a bad connection.
  private async send() {
    const a = this.a;
    const id = this.state.id;
    if (a.sending || !id) return;
    a.sending = true;
    this.set({ stalled: false });
    while (a.queue.length) {
      const job = a.queue[0];
      try {
        const res = await fetch(`/api/lectures/${id}/chunk`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ audio: await base64(job.blob), mimeType: "audio/wav", offset: job.offset, length: job.length, captions: job.captions }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { segments: Segment[]; duration: number };
        if (a.queue[0] === job) a.queue.shift();
        this.transcribed(job, body.segments, body.duration);
      } catch {
        if (++job.tries >= 4) {
          a.sending = false;
          return this.set({ stalled: true });
        }
        await new Promise((ok) => setTimeout(ok, 2000 * 2 ** job.tries));
      }
    }
    a.sending = false;
    if (this.a === a && this.state.status === "finishing") void this.finish();
  }

  // A minute of class came back transcribed. It replaces whatever the note had for that minute,
  // as on the server, and the browser's captions of it are no longer needed.
  private transcribed(job: Job, added: Segment[], duration: number) {
    const end = job.offset + job.length;
    const kept = this.state.segments.filter((s) => s.start < job.offset || s.start >= end);
    this.set({
      segments: [...kept, ...added].sort((x, y) => x.start - y.start),
      duration: Math.max(this.state.duration, duration),
      pending: this.a.queue.length,
    });
    this.draw({ heard: this.meter.heard.filter((c) => c.t >= end) });
    if (this.a.gemini) void this.writeParts();
  }

  // Writes notes for each finished 10 minutes of class that has none yet, one at a time. It runs
  // after every transcribed minute, and catches up before the notes are finished.
  private writeParts(): Promise<void> {
    if (this.partsQueued) return this.partsJob;
    this.partsQueued = true;
    this.partsJob = this.partsJob
      .then(async () => {
        this.partsQueued = false;
        const id = this.state.id;
        while (id && this.state.id === id && ACTIVE.includes(this.state.status)) {
          const next = nextWindow(this.state.segments, this.state.parts);
          if (!next) break;
          this.set({ writing: next });
          const res = await fetch(`/api/lectures/${id}/parts`, { method: "POST", headers: JSON_HEADERS, body: "{}" }).catch(() => null);
          const out = (await res?.json().catch(() => null)) as { parts?: NotePart[]; title?: string; written?: boolean } | null;
          if (!res?.ok || !out?.parts) break; // the next minute tries again, and finishing picks up the rest
          this.set({ parts: out.parts, title: out.title || this.state.title });
          if (!out.written) break;
        }
        this.set({ writing: null });
      })
      .catch(() => this.set({ writing: null }));
    return this.partsJob;
  }

  pause() {
    if (!this.live) return;
    const pausing = this.state.status === "recording";
    this.set({ status: pausing ? "paused" : "recording" });
    this.draw({ level: 0, now: "" });
    if (pausing) safe(() => this.a.recog?.stop());
    else safe(() => this.a.recog?.start());
  }

  stop() {
    if (!this.live) return;
    this.set({ status: "finishing" });
    this.cut();
    this.teardown();
    this.draw({ level: 0, now: "" });
    if (!this.a.queue.length && !this.a.sending) void this.finish();
  }

  // Sends the minutes that couldn't go through again.
  retry() {
    for (const j of this.a.queue) j.tries = 0;
    void this.send();
  }

  // Writes the notes from what was transcribed, leaving out minutes that couldn't be sent.
  // Their audio stays on this device.
  skipUnsent() {
    if (this.state.status !== "finishing" || this.a.sending) return;
    this.a.queue = [];
    void this.finish();
  }

  // The finished notes, from the parts written while the class recorded.
  private async finish() {
    const id = this.state.id;
    if (!id || this.state.status === "writing") return;
    this.set({ status: "writing", stalled: false, pending: 0 });
    if (!this.state.segments.length) return this.end({ failed: "Nothing was transcribed, so there are no class notes to write." });
    await this.flushers.get(id)?.().catch(() => undefined); // your notes steer the class notes, so they're saved first
    const long = span(this.state.segments) > ONE_GO_SECONDS;
    if (this.a.gemini && (long || this.state.parts.length)) await this.writeParts();
    const res = await fetch(`/api/lectures/${id}/notes`, { method: "POST", headers: JSON_HEADERS, body: "{}" }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as (Partial<Finished> & { error?: string }) | null;
    if (!res?.ok || !out?.notes) return this.end({ failed: out?.error ?? "Couldn't write the class notes. Open the note and try again." });
    const parts = out.parts ?? this.state.parts;
    this.end({ done: { notes: out.notes, title: out.title ?? "", titleAuto: !!out.titleAuto, parts }, parts });
  }

  private end(patch: Partial<RecState>) {
    this.listen(false);
    this.set({ ...patch, status: "done", writing: null });
  }

  // Forgets a finished recording, once its notes are shown or dismissed, or an error once read.
  clear() {
    if (!ACTIVE.includes(this.state.status)) this.set(IDLE);
  }

  // The note's page saves what you just typed before the notes are finished. Returns the undo.
  beforeNotes(id: string, flush: () => Promise<void>) {
    this.flushers.set(id, flush);
    return () => void (this.flushers.get(id) === flush && this.flushers.delete(id));
  }

  // Keeps the recorder's link to the note right when you rename or move it.
  rename(id: string, patch: { name: string; href: string }) {
    if (this.state.id === id && (this.state.name !== patch.name || this.state.href !== patch.href)) this.set(patch);
  }

  private startCaptions() {
    const Impl = speech();
    if (!Impl) return;
    const a = this.a;
    const rec = new Impl();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-CA";
    rec.onresult = (e) => {
      let now = "";
      const heard = [...this.meter.heard];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!r.isFinal) now += ` ${text}`;
        else if (text) {
          const c = { t: this.now(), text };
          a.captions.push(c);
          heard.push(c);
        }
      }
      this.draw({ heard: heard.slice(-60), now: now.trim() });
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") (a.recog = null), this.set({ captions: false });
    };
    // Recognition stops by itself after a pause in speech; keep it going for the whole class.
    rec.onend = () => {
      if (this.state.status === "recording" && a.recog === rec) setTimeout(() => a.recog === rec && this.state.status === "recording" && safe(() => rec.start()), 250);
    };
    a.recog = rec;
    this.set({ captions: true });
    safe(() => rec.start());
  }

  // Keeps the screen on while recording. The lock is let go whenever the page is hidden, so it's
  // asked for again when you come back.
  private async keepAwake() {
    const lock = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!lock || document.visibilityState !== "visible") return;
    try {
      await this.a.wake?.release().catch(() => {});
      this.a.wake = await lock.request("screen");
    } catch {}
  }

  private listen(on: boolean) {
    const f = on ? "addEventListener" : "removeEventListener";
    window[f]("beforeunload", this.warn);
    document[f]("visibilitychange", this.back);
  }

  // Warns before closing the tab mid-class: the recording only runs while Pace is open.
  private warn = (e: BeforeUnloadEvent) => {
    if (ACTIVE.includes(this.state.status)) e.preventDefault();
  };

  // Back from another tab or app: some browsers pause the audio while the page is hidden.
  private back = () => {
    if (document.visibilityState !== "visible" || !this.live) return;
    void this.a.ctx?.resume().catch(() => {});
    void this.keepAwake();
  };

  private micLost = () => {
    if (!this.live) return;
    this.set({ error: "The microphone stopped, so the recording ended there. Everything recorded up to then is kept." });
    this.stop();
  };

  private teardown() {
    const a = this.a;
    const recog = a.recog;
    a.recog = null;
    safe(() => recog?.stop());
    a.proc?.disconnect();
    a.stream?.getTracks().forEach((t) => (t.removeEventListener("ended", this.micLost), t.stop()));
    void a.ctx?.close().catch(() => {});
    void a.wake?.release().catch(() => {});
    Object.assign(a, { proc: null, stream: null, ctx: null, wake: null });
  }
}

export const recording = new Recorder();

export const useRecording = () => useSyncExternalStore(recording.subscribe, () => recording.state, () => IDLE);
export const useMeter = () => useSyncExternalStore(recording.subscribeMeter, () => recording.meter, () => QUIET);

// The browser's live captions (Web Speech API), when it has them.
function speech() {
  const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return W.SpeechRecognition ?? W.webkitSpeechRecognition;
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
