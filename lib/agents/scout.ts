import { gemini, hasGemini } from "../gemini";
import { getProfile, listOpportunities, saveOpportunity, saveProfile, deleteOpportunity } from "../careers-store";
import {
  daysBetween, dedupeKey, emptyOpportunity, isDay, newId, OPP_KINDS, profileSummary, torontoToday,
  type CareerProfile, type OppKind, type Opportunity,
} from "../careers";
import { clamp, heuristicRelevance } from "./apply";

// Scout agent: once a day it searches the web (Gemini with Google Search grounding, on the
// free tier) for internships, practicums and conferences that fit your profile, checks the
// career sites you follow, and drops what it finds into an inbox for you to review.

const MAX_NEW_PER_RUN = 8;
const STALE_SUGGESTION_DAYS = 21;

interface Found {
  title: string;
  organization: string;
  kind: string;
  location: string;
  url: string;
  deadline: string | null;
  startDate: string;
  summary: string;
  requirements: string[];
  whyRelevant: string;
  relevance: number;
}

const FORMAT =
  'Reply with JSON only: {"items":[{"title":"","organization":"","kind":"internship|practicum|co-op|new-grad|conference|fellowship|event",' +
  '"location":"","url":"","deadline":"YYYY-MM-DD or null","startDate":"","summary":"2 sentences","requirements":["up to 5 short items"],' +
  '"whyRelevant":"one sentence naming the specific skill, goal or location it matches","relevance":0}]}. ' +
  "url must be the actual posting or official page you found in search results, never a guess. relevance is 0 to 100 fit with this student. " +
  "Only include opportunities that are open now or open soon; skip anything whose deadline has passed. If you find nothing good, return an empty list.";

export interface SearchTask {
  label: string;
  prompt: string;
}

export function searchTasks(p: CareerProfile, exclude: string[], today = torontoToday()): SearchTask[] {
  const who = `Today is ${today}.\n\nStudent profile:\n${profileSummary(p)}\n\n`;
  const skip = exclude.length ? `\n\nAlready known, don't repeat: ${exclude.slice(0, 40).join("; ")}.` : "";
  const tasks: SearchTask[] = [
    {
      label: "internships",
      prompt:
        who +
        `Search the web for the most relevant open internships, summer student roles, co-ops or practicum placements for this student. ` +
        `Start with ${p.location || "Canada"} and the rest of Canada, then ${p.regions || "remote roles"}. ` +
        `Prefer postings on company career sites and university or government job boards. Up to 5 items, best fit first.` +
        skip + "\n\n" + FORMAT,
    },
  ];
  if (p.companies.length) {
    tasks.push({
      label: "companies",
      prompt:
        who +
        "Check these companies' career sites for open internship, working student, co-op, practicum or graduate roles that fit this student, " +
        "in Canada first and abroad if the student is open to it:\n" +
        p.companies.map((c) => `- ${c.name}${c.url ? ` (${c.url})` : ""}`).join("\n") +
        `\nUp to 2 items per company.` + skip + "\n\n" + FORMAT,
    });
  }
  if (p.conferences) {
    tasks.push({
      label: "conferences",
      prompt:
        who +
        `Search for upcoming conferences, hackathons, student programs, scholarships with applications, and career fairs that would help this student's goals, ` +
        `in or near ${p.location || "Canada"} or online, with student pricing, travel grants or calls for applications. Up to 4 items.` +
        skip + "\n\n" + FORMAT,
    });
  }
  return tasks;
}

// Search results sometimes carry made-up or dead links; keep only links that load, else
// fall back to a grounding source from the same site, else a web search for the posting.
async function checkUrl(url: string, org: string, title: string, sources: { title: string; url: string }[]): Promise<string> {
  const search = `https://www.google.com/search?q=${encodeURIComponent(`${title} ${org}`)}`;
  if (!/^https?:\/\//i.test(url)) return pickSource(org, sources) ?? search;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 (Pace career scout)" } });
    // Many job boards block bots with 403/429; those links usually work in a browser.
    if (res.ok || [401, 403, 405, 429].includes(res.status)) return url;
  } catch {}
  return pickSource(org, sources) ?? search;
}

function pickSource(org: string, sources: { title: string; url: string }[]): string | null {
  const key = org.toLowerCase().split(/\s+/)[0];
  return key.length > 2 ? sources.find((s) => s.title.toLowerCase().includes(key))?.url ?? null : null;
}

export function normalize(f: Partial<Found>, p: CareerProfile, today = torontoToday()): Omit<Opportunity, "id" | "createdAt" | "updatedAt"> | null {
  const title = String(f.title ?? "").trim().slice(0, 160);
  const organization = String(f.organization ?? "").trim().slice(0, 120);
  if (!title || !organization) return null;
  const deadline = isDay(f.deadline) ? f.deadline : null;
  if (deadline && daysBetween(today, deadline) < 0) return null;
  const base = {
    ...emptyOpportunity(),
    title,
    organization,
    kind: (OPP_KINDS.includes(f.kind as OppKind) ? f.kind : "internship") as OppKind,
    location: String(f.location ?? "").slice(0, 120),
    url: String(f.url ?? "").trim(),
    deadline,
    startDate: String(f.startDate ?? "").slice(0, 80),
    summary: String(f.summary ?? "").slice(0, 600),
    requirements: (Array.isArray(f.requirements) ? f.requirements : []).map((r) => String(r).slice(0, 160)).slice(0, 6),
    whyRelevant: String(f.whyRelevant ?? "").slice(0, 300),
    status: "suggested" as const,
    source: "agent" as const,
  };
  const relevance = f.relevance != null ? clamp(f.relevance) : heuristicRelevance(base, p);
  // Strong fits with a close deadline go straight to the priority section once you accept them.
  const priority = relevance >= 80 && !!deadline && daysBetween(today, deadline) <= 21;
  return { ...base, relevance, priority };
}

export interface ScoutResult {
  added: Opportunity[];
  searched: string[];
  failed: string[];
  note: string;
}

export async function runScout(): Promise<ScoutResult> {
  const profile = await getProfile();
  if (!hasGemini()) {
    return { added: [], searched: [], failed: [], note: "Add GEMINI_API_KEY to let the Scout search the web." };
  }
  const existing = await listOpportunities();
  const today = torontoToday();

  // Unreviewed suggestions go stale; old dismissed ones are only kept to avoid repeats.
  for (const o of existing) {
    const age = daysBetween(o.createdAt.slice(0, 10), today);
    if (o.status === "suggested" && (age > STALE_SUGGESTION_DAYS || (o.deadline && o.deadline < today))) {
      await saveOpportunity({ ...o, status: "dismissed" });
      o.status = "dismissed";
    } else if (o.status === "dismissed" && age > 120) {
      await deleteOpportunity(o.id);
    }
  }

  const seen = new Set(existing.flatMap(dedupeKey));
  const exclude = existing.map((o) => `${o.title} at ${o.organization}`);
  const tasks = searchTasks(profile, exclude, today);

  const results = await Promise.allSettled(
    tasks.map((t) => gemini<{ items: Found[] }>({ system: "You are a careful job and opportunity researcher. You only report real postings you found with search.", prompt: t.prompt, search: true, schema: {}, temperature: 0.2 })),
  );

  const failed: string[] = [];
  const candidates: { item: ReturnType<typeof normalize>; sources: { title: string; url: string }[] }[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error("scout", tasks[i].label, r.reason);
      failed.push(tasks[i].label);
      return;
    }
    for (const f of r.value.data?.items ?? []) candidates.push({ item: normalize(f, profile, today), sources: r.value.sources });
  });

  const fresh: { item: NonNullable<ReturnType<typeof normalize>>; sources: { title: string; url: string }[] }[] = [];
  for (const c of candidates) {
    if (!c.item) continue;
    const keys = dedupeKey(c.item);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    fresh.push({ item: c.item, sources: c.sources });
  }
  fresh.sort((a, b) => b.item.relevance - a.item.relevance);

  const now = new Date().toISOString();
  const picked = fresh.slice(0, MAX_NEW_PER_RUN);
  const urls = await Promise.all(picked.map(({ item, sources }) => checkUrl(item.url, item.organization, item.title, sources)));
  // Saved one at a time: the local JSON fallback store can't take concurrent writes.
  const added: Opportunity[] = [];
  for (const [i, { item }] of picked.entries()) added.push(await saveOpportunity({ ...item, url: urls[i], id: newId(), createdAt: now, updatedAt: now }));

  const note = added.length
    ? `Found ${added.length} new ${added.length === 1 ? "opportunity" : "opportunities"}${failed.length ? ` (the ${failed.join(" and ")} search didn't finish)` : ""}.`
    : failed.length === tasks.length
      ? "The searches didn't finish today, probably the free-tier rate limit. It will try again tomorrow."
      : "Nothing new that fits today.";
  await saveProfile({ ...profile, lastScoutAt: now, lastScoutNote: note });
  return { added, searched: tasks.map((t) => t.label), failed, note };
}
