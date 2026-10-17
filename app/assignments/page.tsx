import Link from "next/link";
import { isDemo, isRecent } from "@/lib/canvas";
import { courseColor } from "@/lib/colors";
import { loadAll } from "@/lib/data";
import { countdown, formatDue } from "@/lib/format";
import { STATUS_LABEL, isGroupWork, type Assignment, type Progress } from "@/lib/types";

export const dynamic = "force-dynamic";

type Item = { a: Assignment; p: Progress };

const isDone = ({ a, p }: Item) => a.submitted || p.status === "done";

function Card({ a, p }: Item) {
  const c = countdown(a.dueAt);
  const done = isDone({ a, p });
  const status = done ? "done" : p.status;
  return (
    <Link href={`/a/${a.id}`} className={`card-g ${done ? "is-done" : `u-${c.urgency}`}`}>
      <div className="deadline">
        {done ? (
          <div className="countdown"><span className="cd-label">{a.submitted ? "Submitted" : "Done"}</span></div>
        ) : (
          <div className="countdown">
            <span className="cd-value">{c.value}</span>
            <span className="cd-label">{c.label}</span>
          </div>
        )}
        <div className="due-date">{formatDue(a.dueAt)}</div>
      </div>
      <div className="body">
        <div className="tags">
          <span className="chip" style={{ background: `${courseColor(a.courseCode)}1f`, color: courseColor(a.courseCode) }}>{a.courseCode}</span>
          <span className={`kind ${isGroupWork(a, p) ? "group" : "solo"}`}>{isGroupWork(a, p) ? "Group" : "Individual"}</span>
        </div>
        <div className="title">{a.name}</div>
      </div>
      <div className="foot">
        <div className="bar"><span style={{ width: `${done ? 100 : p.percent}%` }} /></div>
        <div className="foot-row">
          <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>
          <span className="muted small">
            {p.resources.length > 0 ? `${p.resources.length} resource${p.resources.length > 1 ? "s" : ""}` : `${done ? 100 : p.percent}%`}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Gallery({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <h2 className="section-title">{title} <span className="count">{items.length}</span></h2>
      {items.length === 0 ? (
        <p className="muted small">Nothing due.</p>
      ) : (
        <div className="gallery">{items.map((it) => <Card key={it.a.id} {...it} />)}</div>
      )}
    </section>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course } = await searchParams;
  const { assignments, progress } = await loadAll();
  const all = assignments.filter(isRecent);
  const courses = [...new Set(all.map((a) => a.courseCode))].sort();
  const items: Item[] = (course ? all.filter((a) => a.courseCode === course) : all).map((a) => ({
    a,
    p: progress[a.id],
  }));

  const open = items.filter((it) => !isDone(it));
  const done = items.filter(isDone);
  const next = open.find((it) => it.a.dueAt && new Date(it.a.dueAt).getTime() > Date.now());
  const nextCd = next && countdown(next.a.dueAt);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">{course ?? "All spaces"}</span>
          <h1>Assignments</h1>
          <p>{open.length} open · {done.length} done in the last two weeks and ahead</p>
        </div>
      </header>
      {isDemo() && (
        <div className="banner">Showing sample assignments. Add your Quercus token (CANVAS_TOKEN) to load your real ones.</div>
      )}
      {next && nextCd && (
        <Link href={`/a/${next.a.id}`} className={`next-up u-${nextCd.urgency}`}>
          <span className="muted small">Next deadline</span>
          <span className="next-name">{next.a.name} <span className="muted">· {next.a.courseCode}</span></span>
          <span className="next-when">{nextCd.value} {nextCd.label} · {formatDue(next.a.dueAt)}</span>
        </Link>
      )}
      <nav className="filters">
        <Link href="/assignments" className={!course ? "on" : ""}>All courses</Link>
        {courses.map((c) => (
          <Link key={c} href={`/assignments?course=${encodeURIComponent(c)}`} className={course === c ? "on" : ""}>{c}</Link>
        ))}
      </nav>
      <Gallery title="Individual" items={open.filter((it) => !isGroupWork(it.a, it.p))} />
      <Gallery title="Group" items={open.filter((it) => isGroupWork(it.a, it.p))} />
      {done.length > 0 && (
        <details className="done-block">
          <summary className="section-title">Done <span className="count">{done.length}</span></summary>
          <div className="gallery">{done.map((it) => <Card key={it.a.id} {...it} />)}</div>
        </details>
      )}
    </>
  );
}
