import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { loadAll } from "@/lib/data";
import { courseStats, insights } from "@/lib/agents/performance";
import { cached } from "@/lib/store";

export const maxDuration = 30;

export async function POST() {
  const { assignments, progress, mastery } = await loadAll();
  const stats = courseStats(assignments, progress);
  const key = createHash("sha1").update(JSON.stringify([stats, mastery.map((m) => [m.key, m.score])])).digest("hex");
  return NextResponse.json(await cached(`insights:${key}`, 12 * 3600, () => insights(stats, mastery)));
}
