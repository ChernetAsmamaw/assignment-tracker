import type { Kv } from "./store";

// Supabase (Postgres) as the database, through its REST API and the project's secret key, so a
// serverless function has no connection to open. Everything is in one table, pace, with one
// row per saved item:
//   collection | id | value (JSON) | expires_at (cached AI answers) | updated_at
// supabase/schema.sql creates the table. It's pasted into Supabase's SQL Editor once.

const TABLE = "pace";
const KV = "kv"; // the collection for settings and cached AI answers
const PAGE = 1000; // rows a request; Supabase sends at most 1,000 unless its Max rows setting allows more
const SCHEMA = "open the SQL Editor in your Supabase project, paste in supabase/schema.sql from this repo and click Run";

export interface SupabaseConfig {
  url: string; // https://<project>.supabase.co
  key: string;
}

// An error whose message is meant for the person using the app. setup: Supabase isn't set up
// properly, so nothing can have been saved there yet.
export class SupabaseError extends Error {
  constructor(
    message: string,
    readonly setup = false,
  ) {
    super(message);
  }
}

// The project and key from the environment, what's wrong with them, or null when Supabase isn't
// set up at all. Vercel's Supabase integration uses the same names.
export function supabaseSetup(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | SupabaseError | null {
  const given = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!given && !key) return null;
  const url = given ? projectUrl(given) : null;
  if (!url)
    return new SupabaseError(
      given
        ? "SUPABASE_URL isn't your Supabase project's URL. Copy it from the Connect button in Supabase: it looks like https://abcdefghijklmnopqrst.supabase.co."
        : "Add SUPABASE_URL in Vercel: your project's URL, from the Connect button in Supabase.",
      true,
    );
  if (!key) return new SupabaseError("Add SUPABASE_SECRET_KEY in Vercel: a secret key from Project Settings, API Keys in Supabase.", true);
  if (role(key) === "anon")
    return new SupabaseError(
      "SUPABASE_SECRET_KEY holds the publishable (anon) key, which can't save anything. Use a secret key from Project Settings, API Keys in Supabase (it starts with sb_secret_).",
      true,
    );
  return { url, key };
}

// The URL as Supabase shows it, the dashboard's address, or just the project's ID.
function projectUrl(given: string): string | null {
  const ref = given.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{20})\b/)?.[1] ?? given.match(/^[a-z0-9]{20}$/)?.[0];
  if (ref) return `https://${ref}.supabase.co`;
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(given) ? given : `https://${given}`);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

// The Postgres role a key acts as. Publishable and anon keys only reach what's public.
function role(key: string): string | null {
  if (key.startsWith("sb_publishable_")) return "anon";
  if (key.startsWith("sb_secret_")) return "service_role";
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role ?? null; // a legacy key is a JWT
  } catch {
    return null;
  }
}

// New keys (sb_...) go only in the apikey header. Legacy keys are JWTs, which also go in Authorization.
const auth = (key: string): Record<string, string> => (key.startsWith("sb_") ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` });

const enc = encodeURIComponent;

async function call(
  c: SupabaseConfig,
  method: "GET" | "POST" | "DELETE",
  query: string,
  init: { body?: unknown; prefer?: string } = {},
  attempt = 0,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${c.url}/rest/v1/${TABLE}?${query}`, {
      method,
      headers: {
        ...auth(c.key),
        ...(init.prefer ? { prefer: init.prefer } : {}),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "ENOTFOUND")
      throw new SupabaseError(`There's no Supabase project at ${c.url}. Copy SUPABASE_URL again from the Connect button in Supabase.`, true);
    if ((e as Error).name === "TimeoutError" || attempt > 0) throw e;
    return call(c, method, query, init, attempt + 1); // a dropped connection: try once more
  }
  if (res.ok) return res;
  const error = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  // Busy or briefly unavailable: wait a little and try again. A paused project (540) stays paused.
  if ((res.status === 429 || (res.status >= 500 && res.status !== 540)) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 200));
    return call(c, method, query, init, attempt + 1);
  }
  throw explain(res.status, error.code ?? "", error.message ?? "");
}

function explain(status: number, code: string, message: string): Error {
  if (code === "PGRST205" || code === "42P01") return new SupabaseError(`Pace's table isn't in Supabase yet: ${SCHEMA}.`, true);
  if (code === "PGRST204" || code === "42703")
    return new SupabaseError(`Supabase already has a table called pace that isn't Pace's. Rename it in the Table Editor, then ${SCHEMA}.`, true);
  if (code === "42501") return new SupabaseError(`Supabase won't let Pace use its table. To give it access, ${SCHEMA}.`, true);
  if (status === 401 || status === 403)
    return new SupabaseError("Supabase didn't accept SUPABASE_SECRET_KEY. Copy a secret key again from Project Settings, API Keys, in the same project as SUPABASE_URL.", true);
  if (status === 404) return new SupabaseError("SUPABASE_URL doesn't lead to a Supabase project. Copy it again from the Connect button in Supabase.", true);
  if (status === 540)
    return new SupabaseError(
      "Your Supabase project is paused: free projects pause after a week without use. Open it in the Supabase dashboard, click Resume project, and reload in a few minutes.",
      true,
    );
  if (status === 402) return new SupabaseError(`Supabase has restricted your project${message ? ` (${message})` : ""}. Its usage page in the Supabase dashboard says why.`, true);
  if (status === 429) return new SupabaseError("Supabase is busy. Wait a minute and try again.");
  return new Error(`Supabase ${status}: ${[code, message].filter(Boolean).join(" ")}`);
}

interface Row {
  id: string;
  value: string;
  expires_at?: string | null;
}

// Every row of a collection, a page at a time.
async function rows(c: SupabaseConfig, collection: string, columns: string): Promise<Row[]> {
  const out: Row[] = [];
  for (;;) {
    const res = await call(c, "GET", `select=${columns}&collection=eq.${enc(collection)}&order=id&limit=${PAGE}&offset=${out.length}`, {
      prefer: "count=exact",
    });
    const page = (await res.json()) as Row[];
    out.push(...page);
    const total = Number(res.headers.get("content-range")?.split("/")[1]); // e.g. 0-999/2400
    if (!page.length || !(out.length < total)) return out;
  }
}

async function row(c: SupabaseConfig, collection: string, id: string, columns: string): Promise<Row | undefined> {
  const res = await call(c, "GET", `select=${columns}&collection=eq.${enc(collection)}&id=eq.${enc(id)}`);
  return ((await res.json()) as Row[])[0];
}

// Saves an item: a new row, or the one it already has.
function put(c: SupabaseConfig, collection: string, id: string, value: unknown, expires: string | null = null) {
  return call(c, "POST", "on_conflict=collection,id", {
    body: { collection, id, value: JSON.stringify(value), expires_at: expires, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

const remove = (c: SupabaseConfig, filter: string) => call(c, "DELETE", filter, { prefer: "return=minimal" });

function parse<T>(value: string | undefined): T | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.error("supabase: a saved value isn't JSON");
    return null;
  }
}

export function supabase(setup: SupabaseConfig | SupabaseError): Kv {
  const c = setup instanceof SupabaseError ? null : setup;
  // Until Supabase is set up nothing can have been saved there, so reads come back empty and
  // the page shows what's missing (problem, below).
  async function read<T>(empty: T, job: (c: SupabaseConfig) => Promise<T>): Promise<T> {
    if (!c) return empty;
    try {
      return await job(c);
    } catch (e) {
      if (e instanceof SupabaseError && e.setup) return empty;
      throw e;
    }
  }
  async function write(job: (c: SupabaseConfig) => Promise<unknown>): Promise<void> {
    if (!c) throw setup;
    await job(c);
  }
  return {
    hgetall: <T>(key: string) =>
      read<Record<string, T>>({}, async (c) => {
        const out: Record<string, T> = {};
        for (const r of await rows(c, key, "id,value")) {
          const value = parse<T>(r.value);
          if (value != null) out[r.id] = value;
        }
        return out;
      }),
    hget: <T>(key: string, field: string) => read<T | null>(null, async (c) => parse<T>((await row(c, key, field, "value"))?.value)),
    hset: (key, field, value) => write((c) => put(c, key, field, value)),
    hdel: (key, field) => write((c) => remove(c, `collection=eq.${enc(key)}&id=eq.${enc(field)}`)),
    get: <T>(key: string) =>
      read<T | null>(null, async (c) => {
        const r = await row(c, KV, key, "value,expires_at");
        return r && !(r.expires_at && Date.parse(r.expires_at) <= Date.now()) ? parse<T>(r.value) : null;
      }),
    // Expired AI answers are cleared out whenever a new one is saved, so they can't pile up.
    set: (key, value, ttl) =>
      write((c) =>
        Promise.all([
          put(c, KV, key, value, ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null),
          ttl && remove(c, `collection=eq.${KV}&expires_at=lt.${enc(new Date().toISOString())}`).catch(() => undefined),
        ]),
      ),
    problem: async () => {
      if (!c) return (setup as SupabaseError).message;
      try {
        await call(c, "GET", "select=id&limit=1");
        return null;
      } catch (e) {
        return e instanceof SupabaseError && e.setup ? e.message : null;
      }
    },
  };
}
