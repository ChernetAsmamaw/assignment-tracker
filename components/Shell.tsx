"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import CommandBar from "./CommandBar";

export interface Space {
  code: string;
  color: string;
  open: number;
}

const PINS = [
  { href: "/", label: "Today", ico: "☀", bg: "linear-gradient(135deg,#ff9b54,#ffb547)" },
  { href: "/plan", label: "Planner", ico: "◷", bg: "linear-gradient(135deg,#5b4cf5,#9a6bff)" },
  { href: "/study", label: "Study", ico: "✎", bg: "linear-gradient(135deg,#e85dc0,#ff7a9a)" },
  { href: "/performance", label: "Performance", ico: "↗", bg: "linear-gradient(135deg,#1f9d8a,#3fc1a5)" },
  { href: "/careers", label: "Internships", ico: "◆", bg: "linear-gradient(135deg,#2f6fed,#4cc3f5)" },
];

function Spaces({ spaces }: { spaces: Space[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const course = path === "/assignments" ? params.get("course") : null;
  return (
    <div className="tabs">
      <Link href="/assignments" className={`tab ${path === "/assignments" && !course ? "on" : ""}`}>
        <span className="dot" style={{ background: "var(--side-text)", opacity: 0.5 }} /> All assignments
        <span className="n">{spaces.reduce((n, s) => n + s.open, 0)}</span>
      </Link>
      {spaces.map((s) => (
        <Link key={s.code} href={`/assignments?course=${encodeURIComponent(s.code)}`} className={`tab ${course === s.code ? "on" : ""}`}>
          <span className="dot" style={{ background: s.color }} /> {s.code}
          <span className="n">{s.open || ""}</span>
        </Link>
      ))}
    </div>
  );
}

export default function Shell({ spaces, signOut, demo, children }: { spaces: Space[]; signOut: boolean; demo: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [cmd, setCmd] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "t")) {
        e.preventDefault();
        setCmd((c) => (c === null ? "" : null));
      }
      if (e.key === "Escape") setCmd(null);
    };
    const onOpen = (e: Event) => setCmd((e as CustomEvent<string>).detail ?? "");
    window.addEventListener("keydown", onKey);
    window.addEventListener("pace:ask", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pace:ask", onOpen);
    };
  }, []);

  if (path === "/login") return <>{children}</>;
  const on = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="shell">
      <aside className="side">
        <div className="lights" aria-hidden><i /><i /><i /></div>
        <Link href="/" className="brand"><span className="logo" /> Pace</Link>
        <button type="button" className="omni" onClick={() => setCmd("")}>
          <span className="spark">✦</span> Ask Pace anything <kbd>⌘K</kbd>
        </button>
        <nav className="pinned">
          {PINS.map((p) => (
            <Link key={p.href} href={p.href} className={`pin ${on(p.href) ? "on" : ""}`}>
              <span className="ico" style={{ background: p.bg }}>{p.ico}</span>
              {p.label}
            </Link>
          ))}
        </nav>
        <div className="side-label">Spaces <Link href="/courses" className={path === "/courses" ? "on" : ""}>Choose</Link></div>
        <Suspense fallback={null}><Spaces spaces={spaces} /></Suspense>
        <div className="side-foot">
          <span>{demo ? "Sample data" : "Synced with Quercus"}</span>
          {signOut && (
            <form method="post" action="/api/logout">
              <button className="link small">Sign out</button>
            </form>
          )}
        </div>
      </aside>
      <main className="panel">
        <div className="panel-inner">{children}</div>
      </main>
      {cmd !== null && <CommandBar initial={cmd} onClose={() => setCmd(null)} />}
    </div>
  );
}

// Lets any page open the command bar, optionally with text filled in.
export const ask = (text = "") => window.dispatchEvent(new CustomEvent("pace:ask", { detail: text }));
