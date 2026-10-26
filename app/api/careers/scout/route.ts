import { NextResponse } from "next/server";
import { runScout } from "@/lib/agents/scout";

export const maxDuration = 60;

// "Search now" button. The daily run is /api/cron/scout.
export async function POST() {
  try {
    return NextResponse.json(await runScout());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
