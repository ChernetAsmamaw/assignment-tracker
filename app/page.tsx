import Link from "next/link";
import { getAssignments, isDemo } from "@/lib/canvas";
import { getAllProgress } from "@/lib/store";
import { formatDue, relativeDue } from "@/lib/format";
import { STATUS_LABEL, emptyProgress, type Assignment, type Progress } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

function bucket(a: Assignment, p: Progress) {
  if (a.submitted || p.status === "done") return "Done";
  if (!a.dueAt) return "No due date";
  const t = new Date(a.dueAt).getTime() - Date.now();
  if (t < 0) return "Overdue";
  if (t < 7 * DAY) return "This week";
  return "Later";
}
const ORDER = ["Overdue", "This week", "Later", "No due date", "Done"];

export default async function Home({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course } = await searchParams;
  const [all, progress] = await Promise.all([getAssignments(), getAllProgress()]);
  const courses = [...new Set(all.map((a) => a.courseCode))].sort();
  const list = course ? all.filter((a) => a.courseCode === course) : all;

  const groups = new Map<string, { a: Assignment; p: Progress }[]>();
  for (const a of list) {
    const p = { ...emptyProgress(), ...progress[a.id] };
    const b = bucket(a, p);
    groups.set(b, [...(groups.get(b) ?? []), { a, p }]);
  }

  return (
    <>
      <header className="top">
        <h1>Assignments</h1>
        {process.env.APP_PASSWORD && (
          <form method="post" action="/api/logout">
            <button className="link small">Sign out</button>
          </form>
        )}
      </header>
      {isDemo() && (
        <div className="banner">Showing sample assignments. Add your Quercus token (CANVAS_TOKEN) to load your real ones.</div>
      )}
      <nav className="filters">
        <Link href="/" className={!course ? "on" : ""}>All</Link>
        {courses.map((c) => (
          <Link key={c} href={`/?course=${encodeURIComponent(c)}`} className={course === c ? "on" : ""}>{c}</Link>
        ))}
      </nav>
      {list.length === 0 && <p className="muted">Nothing here. Enjoy the free time.</p>}
      {ORDER.filter((g) => groups.has(g)).map((g) => (
        <section key={g}>
          <h3 className="section-title">{g} · {groups.get(g)!.length}</h3>
          <div className="list">
            {groups.get(g)!.map(({ a, p }) => {
              const rel = relativeDue(a.dueAt);
              const done = g === "Done";
              const status = a.submitted && p.status !== "done" ? "done" : p.status;
              return (
                <Link key={a.id} href={`/a/${a.id}`} className="row">
                  <div>
                    <div className="name">{a.name}</div>
                    <div className="meta">
                      <span className="chip">{a.courseCode}</span>
                      {formatDue(a.dueAt)}{" "}
                      {rel && !done && <span className={g === "Overdue" ? "overdue" : g === "This week" ? "due-soon" : ""}>· {rel}</span>}
                      {p.resources.length > 0 && <> · {p.resources.length} resource{p.resources.length > 1 ? "s" : ""}</>}
                    </div>
                  </div>
                  <span className={`pill ${status}`}>{a.submitted ? "Submitted" : STATUS_LABEL[status]}</span>
                  {!done && p.percent > 0 && <div className="bar"><span style={{ width: `${p.percent}%` }} /></div>}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
