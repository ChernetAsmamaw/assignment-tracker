"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({ signOut }: { signOut: boolean }) {
  const path = usePathname();
  if (path === "/login") return null;
  const on = (href: string) => (href === "/" ? path === "/" || path.startsWith("/a/") : path.startsWith(href));
  return (
    <nav className="appnav">
      <Link href="/" className="brand">Pace</Link>
      <Link href="/" className={on("/") ? "on" : ""}>Assignments</Link>
      <Link href="/plan" className={on("/plan") ? "on" : ""}>Plan</Link>
      <span style={{ flex: 1 }} />
      {signOut && (
        <form method="post" action="/api/logout">
          <button className="link small">Sign out</button>
        </form>
      )}
    </nav>
  );
}
