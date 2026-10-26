import Link from "next/link";
import { isDemo } from "@/lib/canvas";
import { loadAll } from "@/lib/data";
import { formatDue } from "@/lib/format";
import { hasGemini } from "@/lib/gemini";
import { fmtHours, PRESSURE_LABEL } from "@/lib/planner";
import { CoachCard, EstimateButton, HoursForm, PlannerAgent } from "./PlanClient";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const { plan, settings } = await loadAll();
  const shown = plan.days.slice(0, 14);
  const maxLoad = Math.max(...shown.map((d) => Math.max(d.load, d.capacity)), 1);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Planner agent</span>
          <h1>Your next two weeks</h1>
          <p>Assignment steps fitted into the hours you actually have.</p>
        </div>
      </header>
      {isDemo() && <div className="banner">Planning with sample assignments. Add your Quercus token (CANVAS_TOKEN) to plan your real ones.</div>}

      <PlannerAgent gemini={hasGemini()} overrides={Object.keys(settings.overrides).length} />

      <section className="plan-head">
        <div className={`stat p-${plan.pressure}`}>
          <span className="muted small">This week</span>
          <span className="stat-big">{PRESSURE_LABEL[plan.pressure]}</span>
          <span className="small">{fmtHours(plan.next7Hours)} planned of {fmtHours(plan.next7Capacity)} available</span>
        </div>
        <div className="stat">
          <span className="muted small">Full days</span>
          <span className="stat-big">{plan.fullDays}<span className="muted small"> / 7</span></span>
          <span className="small">{plan.restDay ? "You have a light day this week" : "No light day this week"}</span>
        </div>
        <div className="stat">
          <span className="muted small">At risk</span>
          <span className={`stat-big ${plan.risks.length ? "overdue" : ""}`}>{plan.risks.length}</span>
          <span className="small">{plan.openCount} open assignment{plan.openCount === 1 ? "" : "s"} planned</span>
        </div>
      </section>

      <CoachCard gemini={hasGemini()} />

      {plan.risks.length > 0 && (
        <div className="card risks">
          <h2>Won&apos;t fit as planned</h2>
          {plan.risks.map((r) => (
            <Link key={r.assignmentId} href={`/a/${r.assignmentId}`} className="risk">
              <span><strong>{r.name}</strong> <span className="muted">· {r.courseCode}</span></span>
              <span className="small overdue">
                {r.overdue ? "Overdue" : `${fmtHours(r.overflowHours)} short before ${formatDue(r.dueAt)}`}
              </span>
            </Link>
          ))}
        </div>
      )}

      <h2 className="section-title">Next two weeks</h2>
      <div className="days">
        {shown.map((d) => {
          const over = d.load > d.capacity + 0.01;
          return (
            <div key={d.key} className={`day ${over ? "over" : ""} ${d.weekend ? "weekend" : ""}`}>
              <div className="day-head">
                <strong>{d.label}</strong>
                <span className={`small ${over ? "overdue" : "muted"}`}>{fmtHours(d.load)} / {fmtHours(d.capacity)}</span>
              </div>
              {d.note && <div className="small" style={{ color: "var(--accent)" }}>✦ {d.note}</div>}
              <div className="load" title={`${d.load}h of ${d.capacity}h`}>
                <span style={{ width: `${(Math.min(d.load, d.capacity) / maxLoad) * 100}%` }} />
                {over && <span className="extra" style={{ width: `${((d.load - d.capacity) / maxLoad) * 100}%` }} />}
                <i style={{ left: `${(d.capacity / maxLoad) * 100}%` }} />
              </div>
              {d.items.length === 0 ? (
                <p className="muted small" style={{ margin: "6px 0 0" }}>Free</p>
              ) : (
                <ul>
                  {d.items.map((it) => (
                    <li key={it.href + it.title}>
                      <Link href={it.href} className={it.kind === "study" ? "is-study" : ""}>
                        <span className="chip">{it.courseCode}</span>
                        <span className="it-title">{it.title}</span>
                        <span className="muted small">{it.name} · {fmtHours(it.hours)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>How much can you study?</h2>
        <HoursForm initial={settings} />
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          Work is scheduled as early as it fits, so deadlines never sneak up on you. Assignments with steps use
          the steps&apos; hours; others use an estimate.
          {plan.guessed > 0 && ` ${plan.guessed} assignment${plan.guessed === 1 ? " uses" : "s use"} a rough guess.`}
        </p>
        {plan.guessed > 0 && hasGemini() && <EstimateButton count={plan.guessed} />}
      </div>
    </>
  );
}
