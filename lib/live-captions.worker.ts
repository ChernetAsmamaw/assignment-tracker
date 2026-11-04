import * as ort from "onnxruntime-web/wasm";
import vocab from "./moonshine-vocab.json";
import type { FromWorker, ToWorker } from "./live-captions";

// Live captions, worked out on this device as the class is heard, so nothing is sent anywhere and
// nothing is paid for. A voice detector (Silero VAD) finds where someone starts and stops talking,
// and a small speech model (Moonshine tiny, about 28 MB, downloaded the first time and kept by the
// browser) reads what they said. While someone talks, what they've said so far is read again every
// half second or so, so the words show up as they're said; when they pause it's read once more and
// kept as a finished line.

const RATE = 16000;
const FRAME = 512; // the voice detector hears 32 ms at a time
const CONTEXT = 64; // plus the end of the frame before
const frames = (s: number) => Math.round((s * RATE) / FRAME);
const SPEECH = 0.5; // a frame this likely to be speech starts a line
const QUIET = 0.35; // frames under this are quiet
const PAUSE = frames(0.6); // this much quiet ends the line
const LEAD = frames(0.3); // audio kept from before the speech started
const TAIL = frames(0.2); // and from the pause after it
const MIN_SPEECH = frames(0.2); // shorter sounds are noise
const LONGEST = frames(10); // a line that runs on is cut at the quietest moment of its last 3 s
const CUT_IN = frames(3);
const BEHIND = 1.5 * RATE; // samples waiting: stop rereading the line until it catches up
const GIVE_UP = 30 * RATE; // this device can't keep up

// The speech model: Moonshine tiny, quantized, at a fixed commit of its Hugging Face repo, or from
// Moonshine's own site if that's down. A download is only used if it's exactly the expected file.
// Its vocabulary (moonshine-vocab.json) is the 32,000 tokens of the model's tokenizer.json.
const START_TOKEN = 1;
const END_TOKEN = 2;
const LAYERS = 6;
const HEADS = 8;
const HEAD_DIM = 36;
const MODEL_AT = [
  "https://huggingface.co/moonshine-ai/moonshine/resolve/48b4e427b587bcf67797a5be706d6ddc4a298149/onnx/merged/tiny/quantized/",
  "https://download.moonshine.ai/model/tiny/quantized/",
];
const FILES = [
  { name: "encoder_model.onnx", size: 7_937_661, sha256: "c6fc4b7bc5af75c0591fd157a1f3829b533d18e9769a888fd95a62e470dd4f4a" },
  { name: "decoder_model_merged.onnx", size: 20_243_286, sha256: "eed87831c3a6103534aae7d47a5d485025c659a1323901513961c39fe8a1a367" },
];
const CACHE = "pace-live-captions-v1";

ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which the app doesn't have
ort.env.logLevel = "error";
const OPTIONS: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };

let vad: ort.InferenceSession;
let encoder: ort.InferenceSession;
let decoder: ort.InferenceSession;
let after: string[]; // the decoder outputs needed after its first step
let ready = false;

const post = (m: FromWorker) => self.postMessage(m);

// --- Getting ready ------------------------------------------------------------------------------

async function load() {
  try {
    const total = FILES.reduce((n, f) => n + f.size, 0);
    const got = FILES.map(() => 0);
    let shown = -1;
    const progress = (i: number, n: number) => {
      got[i] = n;
      const done = Math.min(0.99, got.reduce((a, b) => a + b, 0) / total);
      if (Math.floor(done * 50) === shown) return; // every 2%
      shown = Math.floor(done * 50);
      post({ type: "progress", done });
    };
    const [silero, enc, dec] = await Promise.all([
      fetch(new URL("@ricky0123/vad-web/dist/silero_vad_v5.onnx", import.meta.url)).then((r) => {
        if (!r.ok) throw new Error(`voice detector: ${r.status}`);
        return r.arrayBuffer();
      }),
      ...FILES.map((f, i) => download(f, (n) => progress(i, n))),
    ]);
    vad = await ort.InferenceSession.create(new Uint8Array(silero), OPTIONS);
    encoder = await ort.InferenceSession.create(new Uint8Array(enc), OPTIONS);
    decoder = await ort.InferenceSession.create(new Uint8Array(dec), OPTIONS);
    after = decoder.outputNames.filter((n) => n === "logits" || n.includes(".decoder."));
    await read([new Float32Array(RATE / 2)]); // the first read is slow; get it over with
    ready = true;
    post({ type: "ready" });
  } catch (e) {
    post({ type: "error", message: `Couldn't get the live captions ready: ${(e as Error)?.message ?? e}` });
  }
}

// A file of the speech model, from the browser's cache after the first time.
async function download(file: (typeof FILES)[number], progress: (bytes: number) => void): Promise<ArrayBuffer> {
  const cache = await self.caches?.open(CACHE).catch(() => null);
  const key = MODEL_AT[0] + file.name;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) {
    const bytes = await hit.arrayBuffer();
    if (await expected(file, bytes)) return progress(bytes.byteLength), bytes;
    await cache?.delete(key).catch(() => false);
  }
  let error: unknown;
  for (const at of MODEL_AT) {
    try {
      const res = await fetch(at + file.name);
      if (!res.ok || !res.body) throw new Error(`${file.name}: ${res.status}`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if ((n += value.length) > file.size) throw new Error(`${file.name}: not the expected file`);
        parts.push(value);
        progress(n);
      }
      const bytes = new Uint8Array(n);
      for (let i = 0, o = 0; i < parts.length; o += parts[i++].length) bytes.set(parts[i], o);
      if (!(await expected(file, bytes.buffer))) throw new Error(`${file.name}: not the expected file`);
      await cache?.put(key, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
      return bytes.buffer;
    } catch (e) {
      error = e;
      progress(0);
    }
  }
  throw error;
}

// The right size and, where the browser can check it, the right contents: not a Wi-Fi sign-in page
// or a download that was cut short.
async function expected(file: (typeof FILES)[number], bytes: ArrayBuffer) {
  if (bytes.byteLength !== file.size) return false;
  if (!self.crypto?.subtle) return true;
  const hash = new Uint8Array(await self.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("") === file.sha256;
}

// --- Listening ----------------------------------------------------------------------------------

// The 32 ms being filled, and where the next sample falls in the recording.
const frame = new Float32Array(FRAME);
let filled = 0;
let pos = -1;

// The voice detector's memory.
let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
let context = new Float32Array(CONTEXT);
const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(RATE)]), [1]);

// What's being said: its frames, how likely each is speech, and where it started (in samples).
interface Line {
  frames: Float32Array[];
  probs: number[];
  start: number;
  speech: number; // frames of speech in it
  quiet: number; // frames of quiet at its end
  read: number; // how many frames it had when it was last read
  text: string; // what that read said
}
let lead: { f: Float32Array; at: number }[] = [];
let line: Line | null = null;
let cost = 300; // ms the last read took, which paces the next

async function hear(samples: Float32Array, at: number) {
  if (at !== pos) {
    await finish(); // a gap: what was heard before it is finished
    filled = 0;
    pos = at;
  }
  for (let i = 0; i < samples.length; ) {
    const n = Math.min(FRAME - filled, samples.length - i);
    frame.set(samples.subarray(i, i + n), filled);
    filled += n;
    i += n;
    pos += n;
    if (filled === FRAME) {
      filled = 0;
      await step(frame.slice(), pos - FRAME);
    }
  }
}

async function step(f: Float32Array, at: number) {
  const p = await speechLikely(f);
  if (!line) {
    lead.push({ f, at });
    if (lead.length > LEAD) lead.shift();
    if (p < SPEECH) return;
    line = { frames: lead.map((x) => x.f), probs: lead.map(() => 0), start: lead[0].at, speech: 1, quiet: 0, read: 0, text: "" };
    line.probs[line.probs.length - 1] = p;
    lead = [];
    return;
  }
  line.frames.push(f);
  line.probs.push(p);
  if (p >= SPEECH) line.speech++;
  line.quiet = p < QUIET ? line.quiet + 1 : 0;
  if (line.quiet >= PAUSE) return finish();
  if (line.frames.length >= LONGEST) return cut();
  if (due(line)) await reread(line);
}

// Read the line again once it has grown by more than the last read took, and is long enough.
function due(l: Line) {
  if (l.speech < MIN_SPEECH || waiting > BEHIND) return false;
  return (l.frames.length - l.read) * FRAME >= Math.max(0.5, (cost / 1000) * 1.5) * RATE;
}

async function reread(l: Line) {
  l.read = l.frames.length;
  const text = await read(l.frames);
  if (line === l && text && text !== l.text) post({ type: "partial", text: (l.text = text), start: l.start / RATE });
}

// They paused: read the whole line one last time and keep it.
async function finish() {
  const l = line;
  line = null;
  if (!l) return;
  const keep = l.frames.slice(0, l.frames.length - Math.max(0, l.quiet - TAIL));
  const text = l.speech >= MIN_SPEECH ? await read(keep) : "";
  if (text) post({ type: "final", text, start: l.start / RATE, end: (l.start + keep.length * FRAME) / RATE });
  else if (l.text) post({ type: "partial", text: "", start: l.start / RATE });
}

// A line that runs on without a pause is cut where it's quietest near its end, so a word isn't
// cut in half, and the rest starts the next line.
async function cut() {
  const l = line!;
  let at = l.frames.length - 1;
  for (let i = at; i >= l.frames.length - CUT_IN; i--) if (l.probs[i] < l.probs[at]) at = i;
  const head = l.frames.slice(0, at + 1);
  const probs = l.probs.slice(at + 1);
  line = { frames: l.frames.slice(at + 1), probs, start: l.start + head.length * FRAME, speech: probs.filter((p) => p >= SPEECH).length, quiet: 0, read: 0, text: "" };
  const text = await read(head);
  if (text) post({ type: "final", text, start: l.start / RATE, end: line.start / RATE });
}

async function speechLikely(f: Float32Array) {
  const input = new Float32Array(CONTEXT + FRAME);
  input.set(context);
  input.set(f, CONTEXT);
  context = f.slice(FRAME - CONTEXT);
  const out = await vad.run({ input: new ort.Tensor("float32", input, [1, input.length]), state, sr });
  state = out.stateN as ort.Tensor;
  return (out.output.data as Float32Array)[0];
}

function forget() {
  line = null;
  lead = [];
  filled = 0;
  pos = -1;
  state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  context = new Float32Array(CONTEXT);
}

// --- Reading ------------------------------------------------------------------------------------

// Speech to text with Moonshine: the encoder hears the audio, then the decoder writes it out one
// token at a time, keeping what it worked out for the tokens before (the past key values). A bit
// of silence after the audio keeps the model from making up an end for a word that's cut off.
async function read(parts: Float32Array[]): Promise<string> {
  const t0 = performance.now();
  const heard = parts.reduce((n, p) => n + p.length, 0);
  const audio = new Float32Array(Math.max(RATE / 2, heard) + 0.4 * RATE);
  parts.reduce((o, p) => (audio.set(p, o), o + p.length), 0);
  const { last_hidden_state } = await encoder.run({ input_values: new ort.Tensor("float32", audio, [1, audio.length]) });
  const past: Record<string, ort.Tensor> = {};
  for (let i = 0; i < LAYERS; i++)
    for (const a of ["decoder", "encoder"])
      for (const b of ["key", "value"]) past[`past_key_values.${i}.${a}.${b}`] = new ort.Tensor("float32", new Float32Array(0), [0, HEADS, 1, HEAD_DIM]);
  const tokens: number[] = [];
  const most = Math.ceil((heard / RATE) * 6) + 2; // nobody says more than 6 tokens a second
  let next = START_TOKEN;
  for (let i = 0; i < most; i++) {
    const feeds = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from([BigInt(next)]), [1, 1]),
      encoder_hidden_states: last_hidden_state,
      use_cache_branch: new ort.Tensor("bool", new Uint8Array([i > 0 ? 1 : 0]), [1]),
      ...past,
    };
    const out = i > 0 ? await decoder.run(feeds, after) : await decoder.run(feeds);
    next = argmax(out.logits.data as Float32Array);
    if (next === END_TOKEN) break;
    tokens.push(next);
    // The encoder's part of the past stays as the first step worked it out.
    for (const [k, v] of Object.entries(out))
      if (k.startsWith("present.") && (i === 0 || k.includes(".decoder."))) past[`past_key_values.${k.slice(8)}`] = v;
    const loop = looping(tokens);
    if (loop) {
      tokens.length -= loop;
      break;
    }
  }
  cost = performance.now() - t0;
  return text(tokens);
}

function argmax(a: Float32Array) {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

// A small model can get stuck saying the same thing over and over, mostly on noise: a word or two
// many times, or a whole phrase twice in a row. Returns how many tokens to drop to keep just one.
function looping(t: number[]) {
  for (let n = 1; n <= 16; n++) {
    const times = n === 1 ? 6 : n <= 4 ? 3 : 2;
    if (t.length < n * times) continue;
    let same = true;
    for (let k = 1; k < times && same; k++) for (let j = 1; j <= n && same; j++) same = t[t.length - j] === t[t.length - j - k * n];
    if (same) return n * (times - 1);
  }
  return 0;
}

// Tokens to text: ▁ is a space, and <0xNN> tokens are the bytes of characters the vocabulary lacks.
const utf8 = new TextDecoder();
function text(tokens: number[]) {
  let out = "";
  let bytes: number[] = [];
  for (const id of tokens) {
    const piece = (vocab as string[])[id];
    if (id < 3 || !piece) continue;
    const byte = /^<0x([0-9A-F]{2})>$/.exec(piece);
    if (byte) {
      bytes.push(parseInt(byte[1], 16));
      continue;
    }
    if (bytes.length) (out += utf8.decode(new Uint8Array(bytes))), (bytes = []);
    out += piece;
  }
  if (bytes.length) out += utf8.decode(new Uint8Array(bytes));
  return out
    .replace(/▁/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,;:])[,;:]+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Messages -----------------------------------------------------------------------------------

// Audio is handled in order, one piece at a time, since a model can only run one thing at once.
const inbox: ToWorker[] = [];
let waiting = 0; // samples in the inbox
let busy = false;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "audio") {
    if (!ready) return;
    waiting += m.samples.length;
  }
  inbox.push(m);
  void work();
};

async function work() {
  if (busy) return;
  busy = true;
  try {
    while (inbox.length) {
      const m = inbox.shift()!;
      if (m.type === "flush") {
        if (ready) await finish();
        forget();
        post({ type: "flushed", id: m.id });
      } else {
        waiting -= m.samples.length;
        if (!ready) continue;
        if (waiting > GIVE_UP) throw new Error("this device can't keep up");
        await hear(m.samples, m.at);
      }
    }
  } catch (e) {
    ready = false;
    inbox.length = 0;
    waiting = 0;
    post({ type: "error", message: `The live captions stopped: ${(e as Error)?.message ?? e}` });
  } finally {
    busy = false;
  }
}

void load();
