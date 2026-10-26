// Recorded audio stays in this browser (IndexedDB), one WAV per transcribed chunk, so a note's
// source can be played back without uploading whole lectures to the server.

export interface StoredChunk {
  lectureId: string;
  offset: number; // seconds into the lecture
  length: number;
  blob: Blob;
}

const DB = "pace-audio";
const STORE = "chunks";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const key = (lectureId: string, offset: number) => `${lectureId}:${String(Math.round(offset * 10)).padStart(8, "0")}`;

export async function saveChunk(c: StoredChunk): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(c, key(c.lectureId, c.offset));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("Couldn't keep the audio on this device", e);
  }
}

export async function loadChunks(lectureId: string): Promise<StoredChunk[]> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll(IDBKeyRange.bound(`${lectureId}:`, `${lectureId}:￿`));
      req.onsuccess = () => resolve(req.result as StoredChunk[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteChunks(lectureId: string): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(IDBKeyRange.bound(`${lectureId}:`, `${lectureId}:￿`));
  } catch {}
}

// 16 kHz mono 16-bit PCM: small enough to upload a minute at a time, and every
// browser and Gemini can read it.
export function wavBlob(samples: Int16Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return new Blob([buf], { type: "audio/wav" });
}
