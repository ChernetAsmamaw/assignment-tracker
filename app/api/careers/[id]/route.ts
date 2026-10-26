import { NextResponse } from "next/server";
import { deleteOpportunity, getOpportunity, saveOpportunity } from "@/lib/careers-store";
import { isDay, OPP_KINDS, PIPELINE, type Opportunity, type OppStatus } from "@/lib/careers";

const STATUSES: OppStatus[] = ["suggested", "dismissed", ...PIPELINE];

// Partial update: only the fields you can edit in the app are accepted.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await getOpportunity(id);
  if (!o) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Partial<Opportunity>;
  const next: Opportunity = { ...o };

  for (const k of ["title", "organization", "location", "url", "startDate", "summary", "whyRelevant", "notes", "coverLetter"] as const) {
    if (typeof b[k] === "string") next[k] = (b[k] as string).slice(0, k === "coverLetter" || k === "notes" ? 20000 : 2000);
  }
  if (b.deadline === null || isDay(b.deadline)) next.deadline = b.deadline ?? null;
  if (b.kind && OPP_KINDS.includes(b.kind)) next.kind = b.kind;
  if (typeof b.priority === "boolean") next.priority = b.priority;
  if (typeof b.relevance === "number") next.relevance = Math.max(0, Math.min(100, Math.round(b.relevance)));
  if (Array.isArray(b.requirements)) next.requirements = b.requirements.map(String).slice(0, 12);
  if (Array.isArray(b.links)) next.links = b.links.slice(0, 40).map((l) => ({ id: String(l.id), title: String(l.title ?? "").slice(0, 200), url: String(l.url ?? "").slice(0, 1000), note: String(l.note ?? "").slice(0, 500) }));
  if (b.plan && o.plan && Array.isArray(b.plan.steps)) {
    // Steps can be checked off, renamed, re-dated, added or removed; the rest of the plan stays as generated.
    next.plan = { ...o.plan, steps: b.plan.steps.slice(0, 20).map((s) => ({ id: String(s.id), title: String(s.title).slice(0, 200), detail: String(s.detail ?? "").slice(0, 600), due: isDay(s.due) ? s.due : o.plan!.steps[0]?.due ?? "", done: !!s.done })) };
  }
  if (b.status && STATUSES.includes(b.status) && b.status !== o.status) {
    next.status = b.status;
    if (b.status === "applied" && !o.appliedAt) next.appliedAt = new Date().toISOString();
  }
  return NextResponse.json(await saveOpportunity(next));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteOpportunity(id);
  return NextResponse.json({ ok: true });
}
