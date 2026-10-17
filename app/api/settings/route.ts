import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/store";

const hours = (v: unknown, fallback: number) => (typeof v === "number" && v >= 0 && v <= 16 ? Math.round(v * 2) / 2 : fallback);

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cur = await getSettings();
  const next = {
    ...cur,
    weekdayHours: hours(body.weekdayHours, cur.weekdayHours),
    weekendHours: hours(body.weekendHours, cur.weekendHours),
    overrides: body.clearOverrides ? {} : cur.overrides,
  };
  await saveSettings(next);
  return NextResponse.json(next);
}
