import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, authToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    // Locally the site stays open; on Vercel a missing password locks it instead of exposing it.
    if (!process.env.VERCEL) return NextResponse.next();
    return new NextResponse(
      "This site is locked: set APP_PASSWORD for the Production environment in Vercel, then redeploy.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie && cookie === (await authToken(password))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // The cron route checks CRON_SECRET itself, and the calendar feed checks its URL token.
  matcher: ["/((?!login|api/login|api/cron|api/calendar|_next|favicon.ico).*)"],
};