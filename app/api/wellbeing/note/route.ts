import { NextResponse } from "next/server";
import { wellbeingNote } from "@/lib/agents/wellbeing";
import { loadAll } from "@/lib/data";
import { cached } from "@/lib/store";
import { burnoutRisk, focusByDay } from "@/lib/wellbeing";

export const maxDuration = 30;

export async function POST() {
  const { plan, checkins, sessions, today, pace } = await loadAll();
  const risk = burnoutRisk(checkins, plan, sessions, today);
  const minutes = focusByDay(sessions, today).reduce((n, d) => n + d.minutes, 0);
  // Keyed on the inputs, so a new check-in or a replan gets a fresh note.
  const key = `wellbeing:${today}:${risk.score}:${plan.next7Hours}:${checkins.length}:${sessions.length}`;
  return NextResponse.json(await cached(key, 6 * 3600, () => wellbeingNote(risk, plan, Object.values(pace), minutes)));
}
