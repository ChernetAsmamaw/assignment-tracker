import { NextResponse } from "next/server";
import { runScout } from "@/lib/agents/scout";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron runs the Scout once a day, before the morning email, with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await runScout();
    return NextResponse.json({ added: r.added.length, searched: r.searched, failed: r.failed, note: r.note });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
