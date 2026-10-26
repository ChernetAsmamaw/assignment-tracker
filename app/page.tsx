import Link from "next/link";
import AskHero from "@/components/AskHero";
import { isDemo } from "@/lib/canvas";
import { courseStats } from "@/lib/agents/performance";
import { loadAll } from "@/lib/data";
import { countdown, formatDue } from "@/lib/format";
import { fmtHours, isOpen, PRESSURE_LABEL } from "@/lib/planner";
import { listOpportunities } from "@/lib/careers-store";
import { deadlineInfo, isToApply, sortPriority, torontoToday } from "@/lib/careers";
import { focusList, studyHref } from "@/lib/study";

export const dynamic = "force-dynamic";

const TZ = "America/Toronto";

export default async function Today() {
  const [{ assignments, progress, plan, studies, mastery }, opps] = await Promise.all([loadAll(), listOpportunities()]);
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = plan.days[0];

  const upcoming = assignments
    .filter((a) => isOpen(a, progress[a.id]) && a.dueAt && new Date(a.dueAt).getTime() > now.getTime())
    .slice(0, 5);
  const next = upcoming[0];
  const focus = focusList(studies, assignments.filter((a) => isOpen(a, progress[a.id])));
  const nextConcept = focus[0];
  const conceptCount = studies.reduce((n, s) => n + s.concepts.length, 0);
  const stats = courseStats(assignments, progress).filter((s) => s.average != null);
  const pts = assignments.filter((a) => a.score != null && a.points);
  const overall = pts.length ? Math.round((pts.reduce((n, a) => n + a.score!, 0) / pts.reduce((n, a) => n + a.points!, 0)) * 100) : null;
  const weakest = [...mastery].sort((a, b) => a.score - b.score)[0];
  const falling = stats.filter((s) => (s.trend ?? 0) <= -8);
  const newFinds = opps.filter((o) => o.status === "suggested").length;
  const nextApp = sortPriority(opps.filter((o) => isToApply(o) && o.deadline && o.deadline >= torontoToday()))[0];

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">{new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(now)}</span>
          <h1>{greeting}.</h1>
          <p>
            {today.items.length
              ? `${fmtHours(today.load)} planned today across ${today.items.length} block${today.items.length === 1 ? "" : "s"}.`
              : "Nothing planned today."}{" "}
            {PRESSURE_LABEL[plan.pressure]} ahead.
          </p>
        </div>
      </header>

      {isDemo() && <div className="banner">You&apos;re looking at sample courses. Add your Quercus token (CANVAS_TOKEN) to load yours.</div>}

      <AskHero />

      <section className="agents">
        <Link href="/plan" className="agent g-plan">
          <span className="ico">◷</span>
          <span className="muted small">Planner agent</span>
          <span className="big">{PRESSURE_LABEL[plan.pressure]}</span>
          <span className="small">{fmtHours(plan.next7Hours)} of {fmtHours(plan.next7Capacity)} this week{plan.risks.length ? ` · ${plan.risks.length} at risk` : ""}</span>
        </Link>
        <Link href={nextConcept ? `${studyHref(nextConcept.courseCode)}#${nextConcept.concept.id}` : "/study"} className="agent g-study">
          <span className="ico">✎</span>
          <span className="muted small">Study</span>
          <span className="big">{focus.length ? `${focus.length} to understand` : conceptCount ? "All understood" : "Your classes"}</span>
          <span className="small">
            {nextConcept
              ? `Next: ${nextConcept.concept.name}${nextConcept.assignment ? ` for ${nextConcept.assignment.name}` : ""}`
              : "Record a class to build your notes and concepts"}
          </span>
        </Link>
        <Link href="/performance" className="agent g-perf">
          <span className="ico">↗</span>
          <span className="muted small">Performance agent</span>
          <span className="big">{overall != null ? `${overall}% avg` : "No grades yet"}</span>
          <span className="small">
            {falling.length ? `${falling.map((s) => s.courseCode).join(", ")} slipping` : weakest ? `Weakest topic: ${weakest.topic} (${weakest.score}%)` : "Take a quiz to measure a topic"}
          </span>
        </Link>
        <Link href="/careers" className="agent g-career">
          <span className="ico">◆</span>
          <span className="muted small">Career agent</span>
          <span className="big">{newFinds ? `${newFinds} new to review` : nextApp ? deadlineInfo(nextApp.deadline).label : "Internships"}</span>
          <span className="small">{nextApp ? `Next application: ${nextApp.organization}, ${nextApp.title}` : newFinds ? "The Scout found openings that fit you" : "Track applications and let the Scout search daily"}</span>
        </Link>
        <Link href={next ? `/a/${next.id}` : "/assignments"} className="agent g-due">
          <span className="ico">⏱</span>
          <span className="muted small">Next deadline</span>
          <span className="big">{next ? `${countdown(next.dueAt).value} ${countdown(next.dueAt).label}` : "All clear"}</span>
          <span className="small">{next ? `${next.courseCode} ${next.name}` : "Nothing due soon"}</span>
        </Link>
      </section>

      <div className="two-col">
        <div className="card">
          <h2>Today&apos;s agenda</h2>
          {today.items.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Free day. Your planner left today open. Rest counts too.</p>
          ) : (
            <div className="agenda">
              {today.items.map((it) => (
                <Link key={it.href + it.title} href={it.href}>
                  <span className="h">{fmtHours(it.hours)}</span>
                  <span>
                    <strong>{it.title}</strong>
                    <span className="muted small" style={{ display: "block" }}>{it.courseCode} · {it.name}</span>
                  </span>
                  <span className={`k ${it.kind}`}>{it.kind === "study" ? "Study" : "Assignment"}</span>
                </Link>
              ))}
            </div>
          )}
          {today.note && <p className="muted small" style={{ margin: "10px 0 0" }}>Lighter day: {today.note}</p>}
        </div>
        <div className="card">
          <h2>Coming up</h2>
          {upcoming.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing due.</p>}
          {upcoming.map((a) => {
            const c = countdown(a.dueAt);
            return (
              <Link key={a.id} href={`/a/${a.id}`} className="res" style={{ color: "var(--text)" }}>
                <span>
                  <strong>{a.name}</strong>
                  <span className="muted small" style={{ display: "block" }}>{a.courseCode} · {formatDue(a.dueAt)}</span>
                </span>
                <span className={`small ${c.urgency === "urgent" || c.urgency === "overdue" ? "overdue" : c.urgency === "soon" ? "due-soon" : "muted"}`} style={{ whiteSpace: "nowrap" }}>
                  {c.value} {c.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
