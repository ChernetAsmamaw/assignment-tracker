import { headers } from "next/headers";
import { calendarToken } from "@/lib/auth";
import { courseColor } from "@/lib/colors";
import { loadAll } from "@/lib/data";
import { hasGemini } from "@/lib/gemini";
import { burnoutRisk, ENERGY_LABEL, focusByDay, RISK_LABEL, type CheckIn } from "@/lib/wellbeing";
import { CalendarLink, WellbeingCoach } from "./WellbeingClient";

export const dynamic = "force-dynamic";

const weekday = (d: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export default async function WellbeingPage() {
  const { plan, checkins, sessions, today, pace } = await loadAll();
  const risk = burnoutRisk(checkins, plan, sessions, today);
  const days = focusByDay(sessions, today, 7);
  const byDay = new Map<string, CheckIn>(checkins.map((c) => [c.date, c]));
  const maxMin = Math.max(60, ...days.map((d) => d.minutes));
  const focusedHours = Math.round(days.reduce((n, d) => n + d.minutes, 0) / 6) / 10;
  const finished = sessions.filter((s) => s.completed).length;
  const paces = Object.values(pace).sort((a, b) => b.factor - a.factor);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const feed = `${origin}/api/calendar/${await calendarToken()}.ics`;

  // Strain gauge: a half circle filled to the score.
  const angle = Math.PI * (1 - risk.score / 100);
  const gx = 60 + 50 * Math.cos(angle);
  const gy = 60 - 50 * Math.sin(angle);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Wellbeing agent</span>
          <h1>Sustainable pace</h1>
          <p>Your energy, sleep and workload in one place, so strain gets caught early, and a planner that learns how long your work really takes.</p>
        </div>
      </header>

      <section className="plan-head">
        <div className={`stat r-${risk.level}`}>
          <span className="muted small">Strain this week</span>
          <svg viewBox="0 0 120 70" className="gauge" role="img" aria-label={`Strain ${risk.score} of 100`}>
            <path d="M10 60 A50 50 0 0 1 110 60" className="track" />
            {risk.score > 0 && <path d={`M10 60 A50 50 0 0 1 ${gx.toFixed(1)} ${gy.toFixed(1)}`} className="fill" />}
            <text x="60" y="56" textAnchor="middle">{risk.score}</text>
          </svg>
          <span className="stat-big" style={{ fontSize: 20 }}>{RISK_LABEL[risk.level]}</span>
        </div>
        <div className="stat">
          <span className="muted small">Energy · 7 days</span>
          <span className="stat-big">{risk.energy ?? "–"}<span className="muted small"> / 5</span></span>
          <span className="small">{risk.sleep != null ? `${risk.sleep}h average sleep` : "Log sleep in your check-in"}</span>
        </div>
        <div className="stat">
          <span className="muted small">Focused · 7 days</span>
          <span className="stat-big">{focusedHours}h</span>
          <span className="small">{finished} finished block{finished === 1 ? "" : "s"} so far</span>
        </div>
      </section>

      <WellbeingCoach gemini={hasGemini()} />

      <div className="two-col">
        <div className="card">
          <h2>Your last 7 days</h2>
          <div className="week-chart">
            {days.map((d) => {
              const c = byDay.get(d.date);
              return (
                <div key={d.date} className="wk-day">
                  <div className="wk-bar" title={`${d.minutes} focused minutes`}>
                    <span style={{ height: `${(d.minutes / maxMin) * 100}%` }} />
                  </div>
                  <strong className="small">{d.minutes ? `${Math.round(d.minutes / 6) / 10}h` : "–"}</strong>
                  <span className={`e-dot e-${c?.energy ?? 0}`} title={c ? `${ENERGY_LABEL[c.energy]}${c.sleep != null ? `, ${c.sleep}h sleep` : ""}` : "No check-in"} />
                  <span className="muted small">{d.date === today ? "Today" : weekday(d.date)}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>Bars are focused time from the ▶ timer on Today. Dots are your check-in energy, from red (drained) to green (great).</p>
          {risk.drivers.length > 0 && (
            <>
              <h2 style={{ marginTop: 18 }}>What&apos;s adding strain</h2>
              <ul className="tips">{risk.drivers.map((d) => <li key={d}>{d}</li>)}</ul>
            </>
          )}
        </div>
        <div className="card">
          <h2>Your real pace</h2>
          {paces.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Start a focus session from Today&apos;s agenda and mark it finished. After two finished blocks in a course, the planner adjusts
              that course&apos;s estimates to how fast you actually work.
            </p>
          ) : (
            paces.map((p) => (
              <div key={p.courseCode} className="pace-row">
                <span className="chip" style={{ background: "transparent", border: `1px solid ${courseColor(p.courseCode)}`, color: "var(--text)" }}>{p.courseCode}</span>
                <span className="small">
                  {Math.abs(p.factor - 1) < 0.05 ? "Right on your estimates" : p.factor > 1 ? `${Math.round((p.factor - 1) * 100)}% longer than estimated` : `${Math.round((1 - p.factor) * 100)}% faster than estimated`}
                  <span className="muted"> · {p.sessions} block{p.sessions === 1 ? "" : "s"}{p.sessions < 2 ? ", needs one more to apply" : ""}</span>
                </span>
                <strong className={p.factor > 1.15 ? "due-soon" : ""}>{p.factor}×</strong>
              </div>
            ))
          )}
          <p className="muted small" style={{ margin: "12px 0 0" }}>Each estimate is blended with an hour of on-plan work, so one slow evening can&apos;t double your plan.</p>
        </div>
      </div>

      <div className="card" id="calendar">
        <h2>Put your plan in your calendar</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Subscribe once and every study block and deadline shows up next to your classes and shifts. It updates as you replan or check in.
          Anyone with this link can see your plan, so keep it to yourself.
        </p>
        <CalendarLink base={feed} />
      </div>
    </>
  );
}
