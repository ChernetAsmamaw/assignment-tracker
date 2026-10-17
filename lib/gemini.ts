// Minimal Gemini API client (REST, no SDK). Every caller has a non-AI fallback,
// so the app keeps working without GEMINI_API_KEY or when the API is down.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig,
      ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
      ...(opts.functions ? { tools: [{ functionDeclarations: opts.functions }] } : {}),
    }),
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  const cand = body.candidates?.[0];
  const parts = (cand?.content?.parts ?? []) as { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
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
