// Internship, practicum and conference tracking. Types and helpers here are shared by
// server pages and client components, so this file must not import the store.

export type OppKind = "internship" | "practicum" | "co-op" | "new-grad" | "conference" | "fellowship" | "event";

// suggested: found by the Scout agent, waiting for you to review it.
export type OppStatus = "suggested" | "saved" | "preparing" | "applied" | "interview" | "offer" | "closed" | "dismissed";

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  due: string; // YYYY-MM-DD
  done: boolean;
}

export interface ApplicationPlan {
  strategy: string;
  focus: string[]; // what to prioritize, most important first
  steps: PlanStep[];
  talkingPoints: string[]; // parts of your background to lead with
  watchOuts: string[];
  ai: boolean;
  generatedAt: string;
}

export interface OppLink {
  id: string;
  title: string;
  url: string;
  note: string;
}

export interface Opportunity {
  id: string;
  title: string;
  organization: string;
  kind: OppKind;
  location: string;
  url: string;
  deadline: string | null; // YYYY-MM-DD, end of day in Toronto
  startDate: string; // free text, e.g. "May 2027, 16 weeks"
  summary: string;
  requirements: string[];
  whyRelevant: string;
  relevance: number; // 0-100 fit with your profile
  priority: boolean;
  status: OppStatus;
  source: "agent" | "manual";
  notes: string;
  coverLetter: string;
  plan: ApplicationPlan | null;
  links: OppLink[];
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  name: string;
  url: string;
}

export interface CareerProfile {
  name: string;
  school: string;
  program: string;
  year: string;
  location: string;
  regions: string; // where you'd go, e.g. "Canada first; open to Europe and the US"
  roles: string; // what you're looking for
  skills: string;
  interests: string;
  workAuth: string;
  experience: string; // resume text, used for fit and cover letters
  companies: Company[]; // career sites the Scout checks every day
  conferences: boolean; // also look for conferences, hackathons and student programs
  lastScoutAt: string | null;
  lastScoutNote: string;
}

export const DEFAULT_PROFILE: CareerProfile = {
  name: "",
  school: "University of Toronto",
  program: "",
  year: "",
  location: "Toronto, ON",
  regions: "Canada first, remote, and abroad for the right role",
  roles: "Summer internship or practicum",
  skills: "",
  interests: "",
  workAuth: "",
  experience: "",
  companies: [{ name: "GFT Technologies", url: "https://jobs.gft.com/" }],
  conferences: true,
  lastScoutAt: null,
  lastScoutNote: "",
};

export const KIND_LABEL: Record<OppKind, string> = {
  internship: "Internship",
  practicum: "Practicum",
  "co-op": "Co-op",
  "new-grad": "New grad",
  conference: "Conference",
  fellowship: "Fellowship",
  event: "Event",
};

export const OPP_KINDS = Object.keys(KIND_LABEL) as OppKind[];

export const STATUS_LABEL: Record<OppStatus, string> = {
  suggested: "To review",
  saved: "Saved",
  preparing: "Preparing",
  applied: "Applied",
  interview: "Interviewing",
  offer: "Offer",
  closed: "Closed",
  dismissed: "Dismissed",
};

// The statuses you move an opportunity through once it's on your list.
export const PIPELINE: OppStatus[] = ["saved", "preparing", "applied", "interview", "offer", "closed"];

export const isToApply = (o: Opportunity) => o.status === "saved" || o.status === "preparing";
export const isInFlight = (o: Opportunity) => o.status === "applied" || o.status === "interview" || o.status === "offer";

export const emptyOpportunity = (): Omit<Opportunity, "id" | "title" | "organization" | "createdAt" | "updatedAt"> => ({
  kind: "internship",
  location: "",
  url: "",
  deadline: null,
  startDate: "",
  summary: "",
  requirements: [],
  whyRelevant: "",
  relevance: 50,
  priority: false,
  status: "saved",
  source: "manual",
  notes: "",
  coverLetter: "",
  plan: null,
  links: [],
  appliedAt: null,
});

export const newId = () => Math.random().toString(36).slice(2, 10);

// ---------- Dates (deadlines are whole days in Toronto) ----------

const TZ = "America/Toronto";

export const torontoToday = (d: Date | number = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);

export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 864e5);

export const addDays = (day: string, n: number) => new Date(toUtc(day) + n * 864e5).toISOString().slice(0, 10);

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toUtc(s));

export function formatDay(day: string | null, withYear = false): string {
  if (!day) return "No deadline";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: withYear ? undefined : "short",
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
  });
}

export type DeadlineUrgency = "overdue" | "urgent" | "soon" | "later" | "none";

export function deadlineInfo(deadline: string | null, today = torontoToday()): { days: number | null; label: string; urgency: DeadlineUrgency } {
  if (!deadline) return { days: null, label: "Rolling / no deadline", urgency: "none" };
  const days = daysBetween(today, deadline);
  if (days < 0) return { days, label: days === -1 ? "Closed yesterday" : `Closed ${-days} days ago`, urgency: "overdue" };
  if (days === 0) return { days, label: "Due today", urgency: "urgent" };
  if (days === 1) return { days, label: "Due tomorrow", urgency: "urgent" };
  return { days, label: `${days} days left`, urgency: days <= 3 ? "urgent" : days <= 14 ? "soon" : "later" };
}

// ---------- Sorting ----------

const byDeadline = (a: Opportunity, b: Opportunity) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");

export const sortPriority = (list: Opportunity[]) => [...list].sort((a, b) => byDeadline(a, b) || b.relevance - a.relevance);
export const sortRelevance = (list: Opportunity[]) => [...list].sort((a, b) => b.relevance - a.relevance || byDeadline(a, b));

export function nextStep(o: Opportunity): PlanStep | null {
  return o.plan?.steps.find((s) => !s.done) ?? null;
}

export function planProgress(o: Opportunity): number {
  const steps = o.plan?.steps ?? [];
  return steps.length ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100) : 0;
}

// Same posting found twice (by the Scout, or added by hand) shouldn't show up twice.
export function dedupeKey(o: Pick<Opportunity, "title" | "organization" | "url">): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const keys = [`t:${norm(o.organization)}|${norm(o.title)}`];
  if (o.url && !o.url.includes("google.com/search")) keys.push(`u:${o.url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase()}`);
  return keys;
}

export function profileSummary(p: CareerProfile): string {
  return [
    p.name && `Name: ${p.name}`,
    `School: ${[p.school, p.program, p.year].filter(Boolean).join(", ") || "not given"}`,
    `Based in: ${p.location || "not given"}`,
    `Open to: ${p.regions || "Canada"}`,
    `Looking for: ${p.roles || "internships"}`,
    p.skills && `Skills: ${p.skills}`,
    p.interests && `Interests: ${p.interests}`,
    p.workAuth && `Work authorization: ${p.workAuth}`,
    p.experience && `Resume / experience:\n${p.experience.slice(0, 5000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
