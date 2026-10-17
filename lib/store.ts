import { Redis } from "@upstash/redis";
import { promises as fs } from "fs";
import path from "path";
import { emptyProgress, type Progress } from "./types";

// Upstash Redis on Vercel; a local JSON file when running without it.
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const HASH = "progress";
const FILE = path.join(process.cwd(), ".data", "progress.json");

async function readFile(): Promise<Record<string, Progress>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function getAllProgress(): Promise<Record<string, Progress>> {
  if (redis) return ((await redis.hgetall<Record<string, Progress>>(HASH)) ?? {});
  return readFile();
}

export async function getProgress(id: string): Promise<Progress> {
  const p = redis ? await redis.hget<Progress>(HASH, id) : (await readFile())[id];
  return { ...emptyProgress(), ...(p ?? {}) };
}

export async function saveProgress(id: string, p: Progress): Promise<void> {
  const value = { ...p, updatedAt: new Date().toISOString() };
  if (redis) {
    await redis.hset(HASH, { [id]: value });
    return;
  }
  const all = await readFile();
  all[id] = value;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}

export interface Settings {
  weekdayHours: number;
  weekendHours: number;
  // Per-day study hours set by the Planner agent, e.g. { "2026-10-20": 1 } for a work shift.
  overrides: Record<string, { hours: number; reason: string }>;
}

export const DEFAULT_SETTINGS: Settings = { weekdayHours: 4, weekendHours: 3, overrides: {} };
const SETTINGS_FILE = path.join(process.cwd(), ".data", "settings.json");

export async function getSettings(): Promise<Settings> {
  let s: Partial<Settings> | null = null;
  if (redis) s = await redis.get<Settings>("settings");
  else {
    try {
      s = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8"));
    } catch {}
  }
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  if (redis) {
    await redis.set("settings", s);
    return;
  }
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

// Short-lived cache for AI answers so reloading a page doesn't call Gemini again.
const memo = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttlSeconds: number, make: () => Promise<T>): Promise<T> {
  const k = `ai:${key}`;
  if (redis) {
    const hit = await redis.get<T>(k);
    if (hit != null) return hit;
    const value = await make();
    await redis.set(k, value, { ex: ttlSeconds });
    return value;
  }
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < ttlSeconds * 1000) return hit.value as T;
  const value = await make();
  memo.set(k, { at: Date.now(), value });
  return value;
}

// Generic keyed collections (study plans, topic mastery): a Redis hash, or a JSON file locally.
export async function listAll<T>(name: string): Promise<Record<string, T>> {
  if (redis) return (await redis.hgetall<Record<string, T>>(name)) ?? {};
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), ".data", `${name}.json`), "utf8"));
  } catch {
    return {};
  }
}

export async function getOne<T>(name: string, id: string): Promise<T | null> {
  if (redis) return (await redis.hget<T>(name, id)) ?? null;
  return (await listAll<T>(name))[id] ?? null;
}

export async function putOne<T>(name: string, id: string, value: T | null): Promise<void> {
  if (redis) {
    if (value === null) await redis.hdel(name, id);
    else await redis.hset(name, { [id]: value });
    return;
  }
  const all = await listAll<T>(name);
  if (value === null) delete all[id];
  else all[id] = value;
  const file = path.join(process.cwd(), ".data", `${name}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(all, null, 2));
}
