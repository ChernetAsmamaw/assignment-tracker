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
