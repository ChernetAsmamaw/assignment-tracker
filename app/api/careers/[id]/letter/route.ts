import { NextResponse } from "next/server";
import { writeCoverLetter, type Tone } from "@/lib/agents/apply";
import { getOpportunity, getProfile, saveOpportunity } from "@/lib/careers-store";

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [o, profile] = await Promise.all([getOpportunity(id), getProfile()]);
  if (!o) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { tone?: Tone; extra?: string };
  const tone: Tone = b.tone === "formal" || b.tone === "concise" ? b.tone : "warm";
  const { letter, ai } = await writeCoverLetter(o, profile, tone, String(b.extra ?? ""));
  const saved = await saveOpportunity({ ...o, coverLetter: letter });
  return NextResponse.json({ letter: saved.coverLetter, ai, profileMissing: !profile.experience && !profile.skills });
}
