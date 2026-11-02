import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/store";

const hours = (v: unknown, fallback: number) => (typeof v === "number" && v >= 0 && v <= 16 ? Math.round(v * 2) / 2 : fallback);

// Applies { key: true } to tick a course or assignment back on and { key: false } to untick it,
// so a single checkbox never overwrites changes made elsewhere.
function toggle(excluded: string[], changes: unknown): string[] {
  if (!changes || typeof changes !== "object") return excluded;
  const out = new Set(excluded);
  for (const [key, on] of Object.entries(changes).slice(0, 500)) {
    if (!key || key.length > 200) continue;
    if (on === true) out.delete(key);
    if (on === false) out.add(key);
  }
  return [...out];
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cur = await getSettings();
  const next = {
    ...cur,
    weekdayHours: hours(body.weekdayHours, cur.weekdayHours),
    weekendHours: hours(body.weekendHours, cur.weekendHours),
    overrides: body.clearOverrides ? {} : cur.overrides,
    excludedCourses: toggle(cur.excludedCourses, body.include?.courses),
    excludedAssignments: toggle(cur.excludedAssignments, body.include?.assignments),
  };
  await saveSettings(next);
  return NextResponse.json(next);
}
