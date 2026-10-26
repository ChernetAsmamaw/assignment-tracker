import Link from "next/link";
import { hasGemini } from "@/lib/gemini";
import { getProfile, listOpportunities } from "@/lib/careers-store";
import { deadlineInfo, isInFlight, isToApply, torontoToday } from "@/lib/careers";
import CareerBoard from "./CareerBoard";

export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const [all, profile] = await Promise.all([listOpportunities(), getProfile()]);
  const items = all.filter((o) => o.status !== "dismissed");
  const today = torontoToday();
  const toApply = items.filter(isToApply);
  const dueSoon = toApply.filter((o) => {
    const d = deadlineInfo(o.deadline, today).days;
    return d != null && d >= 0 && d <= 14;
  });
  const profileReady = !!(profile.skills || profile.experience || profile.program);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Career agent</span>
          <h1>Internships &amp; opportunities</h1>
          <p>Your practicum and summer internship search in one place. The Scout looks for new openings and conferences every morning and asks before adding anything.</p>
        </div>
        <Link href="/careers/profile" className="btn">Profile &amp; Scout settings</Link>
      </header>

      {!profileReady && (
        <div className="banner">
          Tell Pace about your background first: <Link href="/careers/profile">add your program, skills and resume</Link>. The Scout, fit scores and cover letters all use it.
        </div>
      )}

      <section className="plan-head career-stats">
        <div className="stat"><span className="muted small">To apply</span><span className="stat-big">{toApply.length}</span><span className="small">{toApply.filter((o) => o.priority).length} marked priority</span></div>
        <div className={`stat ${dueSoon.length ? "p-crunch" : "p-calm"}`}><span className="muted small">Deadlines in 14 days</span><span className="stat-big">{dueSoon.length}</span><span className="small">{dueSoon[0] ? `Next: ${dueSoon.sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0].organization}` : "Nothing urgent"}</span></div>
        <div className="stat"><span className="muted small">Applied</span><span className="stat-big">{items.filter(isInFlight).length}</span><span className="small">{items.filter((o) => o.status === "interview").length} interviewing</span></div>
        <div className="stat"><span className="muted small">Scout</span><span className="stat-big">{items.filter((o) => o.status === "suggested").length} new</span><span className="small">{profile.lastScoutNote || (hasGemini() ? "Runs every morning" : "Needs GEMINI_API_KEY")}</span></div>
      </section>

      <CareerBoard items={items} today={today} gemini={hasGemini()} />
    </>
  );
}
