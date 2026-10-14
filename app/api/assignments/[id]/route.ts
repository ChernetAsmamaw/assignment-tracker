import { NextResponse } from "next/server";
import { getProgress, saveProgress } from "@/lib/store";
import type { Progress, Status } from "@/lib/types";

const STATUSES: Status[] = ["not_started", "in_progress", "done"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await getProgress(id));
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Partial<Progress>;
  const current = await getProgress(id);
  const next: Progress = {
    ...current,
    status: STATUSES.includes(body.status as Status) ? (body.status as Status) : current.status,
    percent: typeof body.percent === "number" ? Math.min(100, Math.max(0, Math.round(body.percent))) : current.percent,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 20000) : current.notes,
    resources: Array.isArray(body.resources)
      ? body.resources.slice(0, 200).map((r) => ({
          id: String(r.id || crypto.randomUUID()),
          title: String(r.title ?? "").slice(0, 300),
          url: String(r.url ?? "").slice(0, 2000),
          note: String(r.note ?? "").slice(0, 2000),
        }))
      : current.resources,
  };
  await saveProgress(id, next);
  return NextResponse.json(await getProgress(id));
}
