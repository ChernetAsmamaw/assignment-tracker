import Link from "next/link";
import { notFound } from "next/navigation";
import { hasGemini } from "@/lib/gemini";
import { getOpportunity, getProfile } from "@/lib/careers-store";
import { deadlineInfo, formatDay, KIND_LABEL, torontoToday } from "@/lib/careers";
import Detail from "./Detail";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [o, profile] = await Promise.all([getOpportunity(id), getProfile()]);
  if (!o) notFound();
  const today = torontoToday();
  const d = deadlineInfo(o.deadline, today);
  const host = (() => {
    try {
      return new URL(o.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  return (
    <div className="opp-detail">
      <p className="small"><Link href="/careers">← Internships &amp; opportunities</Link></p>
      <header className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <span className="eyebrow">{KIND_LABEL[o.kind]}{o.source === "agent" ? " · found by the Scout" : ""}</span>
          <h1>{o.title}</h1>
          <p>
            <strong style={{ color: "var(--text)" }}>{o.organization}</strong>
            {o.location && ` · ${o.location}`}
            {o.startDate && ` · Starts ${o.startDate}`}
            {o.url && <> · <a href={o.url} target="_blank" rel="noreferrer">{o.url.includes("google.com/search") ? "Search for the posting" : `Open posting${host ? ` on ${host}` : ""}`} ↗</a></>}
          </p>
        </div>
        <div className={`next-up u-${d.urgency}`} style={{ minWidth: 200, margin: 0 }}>
          <span className="muted small">Deadline</span>
          <span className="countdown" style={{ color: "var(--tone)" }}>
            {d.days != null && d.days >= 0 ? <><span className="cd-value">{d.days}</span><span className="cd-label">{d.days === 1 ? "day left" : "days left"}</span></> : <span className="cd-label">{d.label}</span>}
          </span>
          <span className="next-when">{o.deadline ? formatDay(o.deadline, true) : "Apply early: no date listed"}</span>
        </div>
      </header>
      <Detail initial={o} today={today} gemini={hasGemini()} profileReady={!!(profile.skills || profile.experience || profile.program)} />
    </div>
  );
}
