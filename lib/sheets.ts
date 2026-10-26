import { createSign } from "crypto";
import type { Kv } from "./store";

// A Google Sheet as the database, through the free Sheets API and a service account.
// Everything is kept in one tab, "Pace", with one row per saved item:
//   collection | id | updated | value (JSON, continued in the next columns when it's long)
// Rows are never removed (a deleted item keeps its row, with no value), so a row number
// read a moment ago still points at the same item. Only an expired AI answer's row is
// reused, for a new answer.

const TAB = "Pace";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CELL = 45000; // characters per cell, under Google's limit of 50,000
const PARTS = 23; // value columns, D to Z
const FRESH_MS = 250; // reads this close together share one read of the tab

export interface SheetsConfig {
  sheetId: string;
  email: string;
  key: string;
}

// An error whose message is meant for the person using the app. setup: the sheet isn't
// connected properly, so nothing can have been saved there yet.
export class SheetsError extends Error {
  constructor(
    message: string,
    readonly setup = false,
  ) {
    super(message);
  }
}

class NoTab extends Error {}

// The sheet and service account from the environment, what's wrong with them, or null when
// Google Sheets isn't set up at all.
export function sheetsSetup(env: NodeJS.ProcessEnv = process.env): SheetsConfig | SheetsError | null {
  const sheet = env.GOOGLE_SHEET_ID?.trim();
  const json = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!sheet && !json && !env.GOOGLE_CLIENT_EMAIL) return null;
  // The ID, or the sheet's whole address.
  const sheetId = sheet?.match(/\/d\/([\w-]+)/)?.[1] ?? sheet;
  if (!sheetId) return new SheetsError("Add GOOGLE_SHEET_ID in Vercel: the long ID in your Google Sheet's address, between /d/ and /edit.", true);
  let email = env.GOOGLE_CLIENT_EMAIL?.trim();
  let key = env.GOOGLE_PRIVATE_KEY;
  if (json) {
    try {
      // The key file as pasted, or base64 encoded.
      const file = JSON.parse(json.startsWith("{") ? json : Buffer.from(json, "base64").toString("utf8"));
      email = file.client_email;
      key = file.private_key;
    } catch {
      return new SheetsError("GOOGLE_SERVICE_ACCOUNT_JSON isn't valid JSON. Paste the whole key file you downloaded, from { to }.", true);
    }
    if (!email || !key)
      return new SheetsError(
        "GOOGLE_SERVICE_ACCOUNT_JSON isn't a service account key. In Google Cloud, open the service account, then Keys, Add key, Create new key, JSON.",
        true,
      );
  }
  if (!email || !key) return new SheetsError("Add GOOGLE_SERVICE_ACCOUNT_JSON in Vercel: the whole JSON key file of your Google Cloud service account.", true);
  return { sheetId, email, key: key.replace(/\\n/g, "\n") };
}

let token: { value: Promise<string>; until: number } | null = null;

function accessToken(c: SheetsConfig): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const value = signIn(c);
  const t = { value, until: Date.now() + 50 * 60 * 1000 }; // tokens last an hour
  token = t;
  value.catch(() => {
    if (token === t) token = null;
  });
  return value;
}

// The service account signs a token request with its private key (OAuth 2.0 JWT bearer flow).
async function signIn(c: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: c.email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(c.key).toString("base64url");
  } catch {
    throw new SheetsError("The private key in GOOGLE_SERVICE_ACCOUNT_JSON can't be read. Paste the whole key file again, unchanged.", true);
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (res.ok && body.access_token) return body.access_token;
  if (res.status === 429 || res.status >= 500) throw new Error(`Google sign-in failed (${res.status})`);
  throw new SheetsError(
    `Google didn't accept the service account key (${String(body.error_description ?? body.error ?? res.status).replace(/\.$/, "")}). ` +
      "Create a new JSON key for the service account and paste it into GOOGLE_SERVICE_ACCOUNT_JSON.",
    true,
  );
}

async function call<T>(c: SheetsConfig, path: string, init: { method?: string; body?: unknown } = {}, attempt = 0): Promise<T> {
  const res = await fetch(`${API}/${c.sheetId}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await accessToken(c)}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (res.ok) return (await res.json()) as T;
  const message = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? res.statusText;
  if (res.status === 401 && attempt === 0) {
    token = null; // expired or revoked: sign in again, once
    return call(c, path, init, 1);
  }
  // Google allows 60 reads and 60 writes a minute: wait a little and try again.
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
    return call(c, path, init, attempt + 1);
  }
  throw explain(c, res.status, message);
}

function explain(c: SheetsConfig, status: number, message: string): Error {
  if (status === 400 && /unable to parse range/i.test(message)) return new NoTab(message);
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    const link = message.match(/https:\/\/\S+/)?.[0].replace(/[.,)]+$/, "") ?? "https://console.cloud.google.com/apis/library/sheets.googleapis.com";
    return new SheetsError(`Turn on the Google Sheets API for your Google Cloud project (${link}), wait a minute, then reload.`, true);
  }
  if (status === 403) return new SheetsError(`Share your Google Sheet with ${c.email} as an Editor (the Share button in the sheet), then reload.`, true);
  if (status === 404) return new SheetsError("GOOGLE_SHEET_ID doesn't match a Google Sheet. Copy the long ID from the sheet's address, between /d/ and /edit.", true);
  if (status === 429) return new SheetsError("Google Sheets is busy. Wait a minute and try again.");
  return new Error(`Google Sheets ${status}: ${message}`);
}

const range = (cells: string) => encodeURIComponent(`${TAB}!${cells}`);

interface Row {
  row: number;
  collection: string;
  id: string;
  updated: string; // for cached AI answers: when they expire
  value: string;
}
type Rows = Map<string, Row>;

const keyOf = (collection: string, id: string) => `${collection}\u0000${id}`;

let memo: { rows: Promise<Rows>; done?: Rows; at?: number } | null = null;

// The whole tab. Reads made while it's being read, or up to maxAge after, share that read,
// so one page or one save reads it once. maxAge 0 always reads it again.
function rows(c: SheetsConfig, maxAge = FRESH_MS): Promise<Rows> {
  if (memo && maxAge > 0 && (!memo.done || Date.now() - memo.at! <= maxAge)) return memo.rows;
  const m: NonNullable<typeof memo> = { rows: readTab(c) };
  m.rows.then(
    (r) => ((m.done = r), (m.at = Date.now())),
    () => memo === m && (memo = null),
  );
  memo = m;
  return m.rows;
}

async function readTab(c: SheetsConfig): Promise<Rows> {
  let values: unknown[][] = [];
  try {
    values = (await call<{ values?: unknown[][] }>(c, `/values/${range("A2:Z")}?valueRenderOption=UNFORMATTED_VALUE`)).values ?? [];
  } catch (e) {
    if (!(e instanceof NoTab)) throw e;
    await addTab(c);
  }
  const out: Rows = new Map();
  values.forEach((cells, i) => {
    const [collection = "", id = "", updated = "", ...parts] = cells.map((v) => (v == null ? "" : String(v)));
    if (!collection || !id) return;
    const row = { row: i + 2, collection, id, updated, value: parts.join("") };
    // Two servers saving a new item at the same moment can both add a row: the newest wins.
    const seen = out.get(keyOf(collection, id));
    if (!seen || updated >= seen.updated) out.set(keyOf(collection, id), row);
  });
  return out;
}

async function addTab(c: SheetsConfig) {
  try {
    await call(c, ":batchUpdate", {
      method: "POST",
      body: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } } } }] },
    });
  } catch (e) {
    if (!/already exists/i.test((e as Error).message)) throw e; // another server just added it
  }
  await call(c, `/values/${range("A1:D1")}?valueInputOption=RAW`, { method: "PUT", body: { values: [["collection", "id", "updated", "value"]] } });
}

// A value longer than one cell continues in the next columns. The two halves of an emoji stay together.
function split(value: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < value.length; ) {
    let end = Math.min(i + CELL, value.length);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
    parts.push(value.slice(i, end));
    i = end;
  }
  if (parts.length > PARTS) throw new SheetsError("That's too long to save in a Google Sheet.");
  return [...parts, ...Array<string>(PARTS - parts.length).fill("")]; // blanks clear what a longer value left behind
}

let writing: Promise<unknown> = Promise.resolve();

// One write at a time from this server, so its own saves never race each other.
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = writing.then(job, job);
  writing = run.catch(() => undefined);
  return run;
}

// Writes an item's row: the row it already has, the row pick() chooses, or a new one at the end.
function put(c: SheetsConfig, collection: string, id: string, updated: string, value: string, pick?: (all: Rows) => Row | undefined) {
  return serial(async () => {
    const k = keyOf(collection, id);
    let all = await rows(c);
    // Before adding a row, read again in case another server added this item a moment ago.
    if (!all.has(k)) all = await rows(c, 0);
    const at = all.get(k) ?? pick?.(all);
    if (!at && !value) return; // deleting something that was never saved
    const cells = [[collection, id, updated, ...split(value)]];
    let row = at?.row;
    if (row) {
      await call(c, `/values/${range(`A${row}:Z${row}`)}?valueInputOption=RAW`, { method: "PUT", body: { values: cells } });
    } else {
      const res = await call<{ updates?: { updatedRange?: string } }>(c, `/values/${range("A:Z")}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`, {
        method: "POST",
        body: { values: cells },
      });
      row = Number(res.updates?.updatedRange?.match(/![A-Z]+(\d+)/)?.[1]) || undefined;
    }
    // Keep the copy this server holds up to date with its own write.
    if (!row || !memo?.done) memo = null;
    else {
      for (const [key, r] of memo.done) if (r.row === row) memo.done.delete(key);
      memo.done.set(k, { row, collection, id, updated, value });
    }
  });
}

export function sheets(setup: SheetsConfig | SheetsError): Kv {
  const c = setup instanceof SheetsError ? null : setup;
  // Until the sheet is connected nothing can have been saved in it, so reads come back
  // empty and the page shows what's missing (problem, below).
  const read = async (): Promise<Rows> => {
    if (!c) return new Map();
    try {
      return await rows(c);
    } catch (e) {
      if (e instanceof SheetsError && e.setup) return new Map();
      throw e;
    }
  };
  const write = async (collection: string, id: string, updated: string, value: string, pick?: (all: Rows) => Row | undefined) => {
    if (!c) throw setup;
    await put(c, collection, id, updated, value, pick);
  };
  const parse = <T>(row: Row | undefined): T | null => {
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      console.error("sheets: unreadable value in row", row.row);
      return null;
    }
  };
  const now = () => new Date().toISOString();
  return {
    hgetall: async <T>(key: string) => {
      const out: Record<string, T> = {};
      for (const row of (await read()).values()) {
        const value = row.collection === key ? parse<T>(row) : null;
        if (value != null) out[row.id] = value;
      }
      return out;
    },
    hget: async <T>(key: string, field: string) => parse<T>((await read()).get(keyOf(key, field))),
    hset: (key, field, value) => write(key, field, now(), JSON.stringify(value)),
    hdel: (key, field) => write(key, field, now(), ""),
    get: async <T>(key: string) => {
      const all = await read();
      const cache = all.get(keyOf("cache", key));
      return parse<T>(all.get(keyOf("kv", key)) ?? (cache && cache.updated > now() ? cache : undefined));
    },
    // Cached AI answers reuse the row of one that has expired, so the cache can't grow without end.
    set: (key, value, ttl) =>
      ttl
        ? write("cache", key, new Date(Date.now() + ttl * 1000).toISOString(), JSON.stringify(value), (all) =>
            [...all.values()].find((r) => r.collection === "cache" && r.updated < now()),
          )
        : write("kv", key, now(), JSON.stringify(value)),
    problem: async () => {
      if (!c) return (setup as SheetsError).message;
      try {
        await rows(c);
        return null;
      } catch (e) {
        return e instanceof SheetsError && e.setup ? e.message : null;
      }
    },
  };
}
