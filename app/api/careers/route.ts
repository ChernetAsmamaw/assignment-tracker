import { NextResponse } from "next/server";
import { analyzePosting, heuristicRelevance } from "@/lib/agents/apply";
import { getProfile, listOpportunities, saveOpportunity } from "@/lib/careers-store";
import { dedupeKey, emptyOpportunity, isDay, newId, OPP_KINDS, type OppKind } from "@/lib/careers";

export const maxDuration = 30;

// Add an opportunity by hand. Paste the posting and Gemini fills in the rest and scores the fit.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  const posting = String(b.posting ?? "").trim();
  let url = String(b.url ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  const given = {
    title: String(b.title ?? "").trim(),
    organization: String(b.organization ?? "").trim(),
    location: String(b.location ?? "").trim(),
    url,
    deadline: isDay(b.deadline) ? b.deadline : null,
  };
  if (!given.title && !posting) return NextResponse.json({ error: "Give it a title, or paste the posting" }, { status: 400 });

  const profile = await getProfile();
  const ai = await analyzePosting({ ...given, posting }, profile);
  const kind = (OPP_KINDS.includes(b.kind as OppKind) ? b.kind : ai.kind ?? "internship") as OppKind;
  const base = {
    ...emptyOpportunity(),
    title: given.title || ai.title || "Untitled opportunity",
    organization: given.organization || ai.organization || "Unknown organization",
    location: given.location || ai.location || "",
    url,
    deadline: given.deadline ?? ai.deadline ?? null,
    kind,
    startDate: ai.startDate ?? "",
    summary: ai.summary ?? "",
    requirements: ai.requirements ?? [],
    whyRelevant: ai.whyRelevant ?? "",
    notes: String(b.notes ?? ""),
    priority: b.priority === "true",
  };
  const relevance = ai.relevance ?? heuristicRelevance(base, profile);

  const existing = await listOpportunities();
  const keys = new Set(dedupeKey(base));
  const dupe = existing.find((o) => o.status !== "dismissed" && dedupeKey(o).some((k) => keys.has(k)));
  if (dupe) return NextResponse.json({ error: "That's already on your list", id: dupe.id }, { status: 409 });

  const now = new Date().toISOString();
  const saved = await saveOpportunity({ ...base, relevance, id: newId(), createdAt: now, updatedAt: now });
  return NextResponse.json(saved);
}
