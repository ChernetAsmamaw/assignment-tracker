import { calendarToken } from "@/lib/auth";
import { planToIcs } from "@/lib/calendar";
import { loadAll } from "@/lib/data";

export const dynamic = "force-dynamic";

// Subscribable calendar feed of the plan. Outside the password wall (calendar apps can't sign
// in), so the secret token in the URL is what protects it.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.replace(/\.ics$/, "") !== (await calendarToken())) return new Response("Not found", { status: 404 });
  const { plan, assignments } = await loadAll();
  const url = new URL(req.url);
  // ?start=18 sets when each day's blocks begin, Toronto time.
  const start = Number(url.searchParams.get("start"));
  const startHour = Number.isInteger(start) && start >= 6 && start <= 22 ? start : 17;
  return new Response(planToIcs(plan, assignments, startHour, url.origin), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "content-disposition": 'inline; filename="pace.ics"' },
  });
}
