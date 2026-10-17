import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { loadAll } from "@/lib/data";
import { coach } from "@/lib/ai";
import { cached } from "@/lib/store";

export const maxDuration = 30;

export async function POST() {
  const { plan, settings } = await loadAll();
  // Same plan, same advice: only ask Gemini again when the week actually changes.
  const key = createHash("sha1")
    .update(JSON.stringify([settings, plan.days.slice(0, 7).map((d) => [d.key, d.load, d.items.map((i) => i.title)]), plan.risks]))
    .digest("hex");
  return NextResponse.json(await cached(`coach:${key}`, 6 * 3600, () => coach(plan, settings)));
}
