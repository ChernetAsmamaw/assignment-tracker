import { NextResponse } from "next/server";
import { buildReminder, renderEmail, sendReminder } from "@/lib/reminder";

export const dynamic = "force-dynamic";

// Vercel Cron calls this daily with "Authorization: Bearer $CRON_SECRET".
// Add ?preview=1 to see the email without sending it.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    if (new URL(req.url).searchParams.get("preview")) {
      const { pending, progress, days } = await buildReminder();
      if (!pending.length) return NextResponse.json({ pending: 0 });
      return new NextResponse(renderEmail(pending, progress, days).html, {
        headers: { "content-type": "text/html" },
      });
    }
    return NextResponse.json(await sendReminder());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
