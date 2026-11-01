import { NextResponse } from "next/server";
import { recordCheckIn } from "@/lib/agents/wellbeing";

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { energy?: unknown; sleep?: unknown; note?: unknown };
  if (body.energy == null) return NextResponse.json({ error: "Pick how you're feeling" }, { status: 400 });
  const { checkin, capacity } = await recordCheckIn(body);
  return NextResponse.json({ reply: checkin.reply, capacity });
}
