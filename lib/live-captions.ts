// The live captions, worked out on this device while a class records (the work happens in
// live-captions.worker.ts, off the page's thread). The recorder sends it what the microphone hears,
// and it sends back the words: the sentence being said, read again as it goes on, and each
// sentence once it's finished.

export type ToWorker = { type: "audio"; samples: Float32Array; at: number } | { type: "flush"; id: number };

export type FromWorker =
  | { type: "progress"; done: number } // 0 to 1, while the speech model downloads
  | { type: "ready" }
  | { type: "partial"; text: string; start: number } // the sentence being said, so far ("" clears it)
  | { type: "final"; text: string; start: number; end: number }
  | { type: "flushed"; id: number }
  | { type: "error"; message: string };

// start and end are seconds since the first sample this recording sent.

const EARLY = 20 * 16000; // samples heard while getting ready that can still be caught up on

export class LiveCaptions {
  private worker: Worker;
  private ready = false;
  private early: { samples: Float32Array; at: number }[] = [];
  private earlyLength = 0;
  private flushes = new Map<number, () => void>();
  private n = 0;

  static supported() {
    return typeof Worker !== "undefined" && typeof WebAssembly === "object";
  }

  constructor(on: (e: FromWorker) => void) {
    this.worker = new Worker(new URL("./live-captions.worker.ts", import.meta.url));
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "flushed") return this.flushes.get(m.id)?.();
      if (m.type === "ready") this.ready = true;
      if (m.type === "error") this.ready = false;
      on(m);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.ready = false;
      on({ type: "error", message: e.message || "The live captions stopped." });
    };
  }

  // 16 kHz mono samples; at is the index of the first one in this recording. Until it's ready,
  // the last 20 seconds are kept, to catch up on.
  hear(samples: Float32Array, at: number) {
    if (this.ready) return this.worker.postMessage({ type: "audio", samples, at } satisfies ToWorker, [samples.buffer]);
    this.early.push({ samples, at });
    this.earlyLength += samples.length;
    while (this.earlyLength - this.early[0].samples.length >= EARLY) this.earlyLength -= this.early.shift()!.samples.length;
  }

  // Once it's ready: caption what was said while it got ready too, or only what's said from now.
  catchUp(yes: boolean) {
    if (yes) for (const e of this.early) this.hear(e.samples, e.at);
    this.early = [];
    this.earlyLength = 0;
  }

  // Finishes the sentence being heard, for a pause or the end of the class. Waits at most ms.
  flush(ms = 2500): Promise<void> {
    const id = ++this.n;
    return new Promise((ok) => {
      const done = () => {
        clearTimeout(timer);
        this.flushes.delete(id);
        ok();
      };
      const timer = setTimeout(done, this.ready ? ms : 0);
      this.flushes.set(id, done);
      this.worker.postMessage({ type: "flush", id } satisfies ToWorker);
    });
  }

  close() {
    this.ready = false;
    this.early = [];
    this.worker.terminate();
    for (const f of [...this.flushes.values()]) f();
  }
}
