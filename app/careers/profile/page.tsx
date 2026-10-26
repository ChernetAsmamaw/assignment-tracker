import Link from "next/link";
import { hasGemini } from "@/lib/gemini";
import { getProfile } from "@/lib/careers-store";
import ProfileForm from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function CareerProfilePage() {
  const profile = await getProfile();
  const q = encodeURIComponent(`${profile.roles || "internship"} ${profile.location || "Canada"}`);
  return (
    <div className="detail" style={{ maxWidth: 860 }}>
      <p className="small"><Link href="/careers">← Internships &amp; opportunities</Link></p>
      <header className="page-head">
        <div>
          <span className="eyebrow">Career agent</span>
          <h1>Your profile</h1>
          <p>The Scout searches with this every morning, fit scores compare postings against it, and cover letters are written from it. It stays in your own database.</p>
        </div>
      </header>
      <div className="card coach">
        <span className="ai-badge">{hasGemini() ? "✦ Scout agent · Gemini + Google Search" : "Scout agent"}</span>
        <p className="small" style={{ margin: "8px 0 0" }}>
          {profile.lastScoutAt
            ? <>Last search {new Date(profile.lastScoutAt).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })}: {profile.lastScoutNote}</>
            : hasGemini() ? "Runs every morning at about 6am Toronto time, before your reminder email." : "Add GEMINI_API_KEY to turn on the daily web search."}
        </p>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          Search yourself: <a href={`https://ca.indeed.com/jobs?q=${q}`} target="_blank" rel="noreferrer">Indeed</a>
          {" · "}<a href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(profile.roles || "intern")}&location=${encodeURIComponent(profile.location || "Canada")}`} target="_blank" rel="noreferrer">LinkedIn</a>
          {" · "}<a href={`https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=${encodeURIComponent(profile.roles || "student")}`} target="_blank" rel="noreferrer">Job Bank</a>
          {profile.companies.map((c) => c.url && <span key={c.name}>{" · "}<a href={c.url} target="_blank" rel="noreferrer">{c.name}</a></span>)}
        </p>
      </div>
      <ProfileForm initial={profile} />
    </div>
  );
}
