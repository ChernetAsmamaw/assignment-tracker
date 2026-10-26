import { Redis } from "@upstash/redis";
import { createClient } from "@redis/client";
import { promises as fs } from "fs";
import path from "path";
import { supabase, supabaseSetup, SupabaseError } from "./supabase";
import { emptyProgress, type Progress } from "./types";

// Saved data lives in Supabase or Redis when one is connected, and in .data/*.json when running locally.
// Vercel names the Redis variables differently depending on how the database was added
// (KV_REST_API_URL, the same with a custom prefix, UPSTASH_REDIS_REST_URL, or only a
// redis:// URL for a plain Redis), so any of them works.

export interface Kv {
  hgetall<T>(key: string): Promise<Record<string, T>>;
  hget<T>(key: string, field: string): Promise<T | null>;
  hset(key: string, field: string, value: unknown): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  problem?(): Promise<string | null>; // why nothing can be saved yet, if the database isn't set up right
}

function upstash(url: string, token: string): Kv {
  const r = new Redis({ url, token });
  return {
    hgetall: async <T>(key: string) => (await r.hgetall<Record<string, T>>(key)) ?? {},
    hget: async <T>(key: string, field: string) => (await r.hget<T>(key, field)) ?? null,
    hset: async (key, field, value) => void (await r.hset(key, { [field]: value })),
    hdel: async (key, field) => void (await r.hdel(key, field)),
    get: async <T>(key: string) => (await r.get<T>(key)) ?? null,
    set: async (key, value, ttl) => void (await (ttl ? r.set(key, value, { ex: ttl }) : r.set(key, value))),
  };
}

// A plain Redis over TCP. Values are stored as JSON, as the Upstash client stores them,
// so either client can read what the other wrote.
function tcp(url: string): Kv {
  let open: ReturnType<typeof connect> | null = null;
  function connect() {
    return createClient({ url })
      .on("error", (e) => console.error("redis", e))
      .connect()
      .catch((e) => {
        open = null; // try again on the next call
        throw e;
      });
  }
  const db = () => (open ??= connect());
  const parse = <T>(v: unknown): T | null => {
    if (v == null) return null;
    try {
      return JSON.parse(String(v)) as T;
    } catch {
      return v as T;
    }
  };
  return {
    hgetall: async <T>(key: string) =>
      Object.fromEntries(Object.entries(await (await db()).hGetAll(key)).map(([k, v]) => [k, parse<T>(v)])) as Record<string, T>,
    hget: async <T>(key: string, field: string) => parse<T>(await (await db()).hGet(key, field)),
    hset: async (key, field, value) => void (await (await db()).hSet(key, field, JSON.stringify(value))),
    hdel: async (key, field) => void (await (await db()).hDel(key, field)),
    get: async <T>(key: string) => parse<T>(await (await db()).get(key)),
    set: async (key, value, ttl) => void (await (await db()).set(key, JSON.stringify(value), ttl ? { expiration: { type: "EX", value: ttl } } : undefined)),
  };
}

// Supabase when it's set up. Otherwise Redis: the REST API suits serverless functions best
// (no connection to open), so it's used when both kinds exist.
function findDatabase(): Kv | null {
  const project = supabaseSetup();
  if (project) return supabase(project);
  const env = process.env;
  const likely = (k: string) => (/KV|REDIS|UPSTASH/.test(k) ? 0 : 1);
  const rest = Object.keys(env)
    .filter((k) => /REST_(API_)?URL$/.test(k) && env[k] && env[k.replace(/URL$/, "TOKEN")])
    .sort((a, b) => likely(a) - likely(b) || a.length - b.length)[0];
  if (rest) return upstash(env[rest]!, env[rest.replace(/URL$/, "TOKEN")]!);
  const url = Object.keys(env)
    .filter((k) => /^rediss?:\/\//.test(env[k] ?? ""))
    .sort((a, b) => likely(a) - likely(b) || a.length - b.length)[0];
  return url ? tcp(env[url]!) : null;
}

const kv = findDatabase();

export const NO_DATABASE =
  "Nothing can be saved yet because this site has no database. Connect Supabase: add SUPABASE_URL and " +
  "SUPABASE_SECRET_KEY to this project in Vercel (the README has the steps), then redeploy.";

// Vercel's disk is read-only, so there it can only save to a database.
export const canSave = () => !!kv || !process.env.VERCEL;

// Why saving can't work on this site, if it can't, in words a page can show.
export async function storageProblem(): Promise<string | null> {
  if (!canSave()) return NO_DATABASE;
  return (await kv?.problem?.()) ?? null;
}

// Writes a .data/ file. Write then rename, so two saves at once can't leave a half-written file.
async function writeData(name: string, value: unknown): Promise<void> {
  const file = path.join(process.cwd(), ".data", `${name}.json`);
  try {
    if (!canSave()) throw Object.assign(new Error(NO_DATABASE), { code: "EROFS" });
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, file);
  } catch (e) {
    const code = (e as { code?: string }).code;
    throw code === "EROFS" || code === "EACCES" || code === "EPERM" ? new Error(NO_DATABASE) : e;
  }
}

async function readData<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), ".data", `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

// Why a save failed, in words a page can show.
export function saveError(e: unknown): string {
  console.error("save", e);
  if (e instanceof SupabaseError) return e.message;
  return e instanceof Error && e.message === NO_DATABASE ? NO_DATABASE : "Couldn't save that. Try again.";
}

const HASH = "progress";

export async function getAllProgress(): Promise<Record<string, Progress>> {
  if (kv) return kv.hgetall<Progress>(HASH);
  return (await readData<Record<string, Progress>>(HASH)) ?? {};
}

export async function getProgress(id: string): Promise<Progress> {
  const p = kv ? await kv.hget<Progress>(HASH, id) : (await getAllProgress())[id];
  return { ...emptyProgress(), ...(p ?? {}) };
}

export async function saveProgress(id: string, p: Progress): Promise<void> {
  const value = { ...p, updatedAt: new Date().toISOString() };
  if (kv) return kv.hset(HASH, id, value);
  const all = await getAllProgress();
  all[id] = value;
  await writeData(HASH, all);
}

export interface Settings {
  weekdayHours: number;
  weekendHours: number;
  // Per-day study hours set by the Planner agent, e.g. { "2026-10-20": 1 } for a work shift.
  overrides: Record<string, { hours: number; reason: string }>;
}

export const DEFAULT_SETTINGS: Settings = { weekdayHours: 4, weekendHours: 3, overrides: {} };

export async function getSettings(): Promise<Settings> {
  const s = kv ? await kv.get<Settings>("settings") : await readData<Settings>("settings");
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  if (kv) return kv.set("settings", s);
  await writeData("settings", s);
}

// Short-lived cache for AI answers so reloading a page doesn't call Gemini again.
const memo = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttlSeconds: number, make: () => Promise<T>): Promise<T> {
  const k = `ai:${key}`;
  if (kv) {
    // A cache that can't be read or written only costs a fresh answer.
    const hit = await kv.get<T>(k).catch(() => null);
    if (hit != null) return hit;
    const value = await make();
    await kv.set(k, value, ttlSeconds).catch((e) => console.error("cache", e));
    return value;
  }
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < ttlSeconds * 1000) return hit.value as T;
  const value = await make();
  memo.set(k, { at: Date.now(), value });
  return value;
}

// Generic keyed collections (notes, topic mastery, internships): a Redis hash or rows in Supabase,
// or a JSON file locally.
export async function listAll<T>(name: string): Promise<Record<string, T>> {
  if (kv) return kv.hgetall<T>(name);
  return (await readData<Record<string, T>>(name)) ?? {};
}

export async function getOne<T>(name: string, id: string): Promise<T | null> {
  if (kv) return kv.hget<T>(name, id);
  return (await listAll<T>(name))[id] ?? null;
}

export async function putOne<T>(name: string, id: string, value: T | null): Promise<void> {
  if (kv) return value === null ? kv.hdel(name, id) : kv.hset(name, id, value);
  const all = await listAll<T>(name);
  if (value === null) delete all[id];
  else all[id] = value;
  await writeData(name, all);
}
