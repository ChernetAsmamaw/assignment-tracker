// Minimal Gemini API client (REST, no SDK). Every caller has a non-AI fallback,
// so the app keeps working without GEMINI_API_KEY or when the API is down.

// The free tier allows only a few requests per minute per model, so each call walks a
// chain of models and moves on when one is rate-limited. "latest" aliases come first
// because Google retires pinned versions for new keys (2.5 Flash already 404s).
const SMART = [process.env.GEMINI_MODEL || "gemini-flash-latest", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
const FAST = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const ENDPOINT = process.env.GEMINI_ENDPOINT || "https://generativelanguage.googleapis.com/v1beta/models";

export const hasGemini = () => !!process.env.GEMINI_API_KEY;

type Schema = Record<string, unknown>;

interface GeminiOptions {
  system: string;
  prompt: string;
  schema?: Schema; // OpenAPI-style response schema; the reply is parsed as JSON
  search?: boolean; // ground the answer with Google Search
  functions?: { name: string; description: string; parameters: Schema }[]; // let Gemini pick a tool
  temperature?: number;
  fast?: boolean; // short, simple tasks: start with the Flash-Lite models
}

export interface GeminiResult<T> {
  data: T;
  sources: { title: string; url: string }[];
  call?: { name: string; args: Record<string, unknown> };
}

export async function gemini<T>(opts: GeminiOptions): Promise<GeminiResult<T>> {
  if (!hasGemini()) throw new Error("GEMINI_API_KEY is not set");

  const generationConfig: Record<string, unknown> = { temperature: opts.temperature ?? 0.4 };
  // Search grounding can't be combined with a JSON schema, so grounded calls ask for JSON in the prompt.
  if (opts.schema && !opts.search) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.schema;
  }

  const started = Date.now();
  const send = (model: string) =>
    fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig,
        ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
        ...(opts.functions ? { tools: [{ functionDeclarations: opts.functions }] } : {}),
      }),
      signal: AbortSignal.timeout(Math.max(5_000, 26_000 - (Date.now() - started))),
      cache: "no-store",
    });

  // Rate limits (429), retired models (404), keys still propagating (403) and outages (5xx): try the next model.
  const chain = opts.fast ? [...FAST, ...SMART] : [...SMART, ...FAST];
  let res: Response | null = null;
  for (const model of chain) {
    if (res && Date.now() - started > 20_000) break;
    res = await send(model);
    if (![403, 404, 429, 500, 503].includes(res.status)) break;
  }
  res = res!;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  const cand = body.candidates?.[0];
  const parts = ((cand?.content?.parts ?? []) as { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> } }[])
    .filter((p) => !p.thought);
  const fc = parts.find((p) => p.functionCall)?.functionCall;
  const text = parts.map((p) => p.text ?? "").join("");
  if (fc) return { data: text.trim() as T, sources: [], call: { name: fc.name, args: fc.args ?? {} } };
  if (!text) throw new Error(`Gemini returned no text (${cand?.finishReason ?? "unknown"})`);

  const sources = ((cand?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri: string; title: string } }[])
    .filter((c) => c.web?.uri)
    .map((c) => ({ title: c.web!.title, url: c.web!.uri }));

  const data = opts.schema ? (parseJson(text) as T) : (text.trim() as T);
  return { data, sources };
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  return JSON.parse(start > 0 ? raw.slice(start) : raw);
}

// Quercus descriptions are HTML; Gemini only needs the words.
export function plainText(html: string | null, max = 6000): string {
  if (!html) return "";
  return html
    .replace(/<(br|\/p|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}
