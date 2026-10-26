import { NextResponse } from "next/server";
import { loadAll } from "@/lib/data";
import { estimateHours } from "@/lib/ai";
import { saveProgress } from "@/lib/store";
import { isOpen } from "@/lib/planner";

export const maxDuration = 60;

// Ask Gemini for hour estimates for every open assignment that has no steps or estimate yet.
export async function POST() {
  const { assignments, progress } = await loadAll();
  const todo = assignments.filter((a) => isOpen(a, progress[a.id]) && !progress[a.id].steps.length && progress[a.id].estimateHours == null);
  try {
    const hours = await estimateHours(todo.slice(0, 30));
    // One at a time: the local JSON store isn't safe for parallel writes.
    for (const [id, h] of Object.entries(hours)) await saveProgress(id, { ...progress[id], estimateHours: h });
    return NextResponse.json({ updated: Object.keys(hours).length });
  } catch (e) {
    console.error("estimate", e);
    return NextResponse.json({ error: "Gemini couldn't estimate right now. Try again." }, { status: 502 });
  }
}
