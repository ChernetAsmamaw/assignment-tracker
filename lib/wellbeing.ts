import type { Plan, Pressure } from "./planner";

// Wellbeing and pace: daily energy check-ins and timed focus sessions. Both feed
// back into the planner, so the plan fits the student you are today, not an
// average one. Everything here is deterministic; Gemini only writes the words.

export type Energy = 1 | 2 | 3 | 4 | 5;

export const ENERGY_LABEL: Record<Energy, string> = { 1: "Drained", 2: "Low", 3: "Okay", 4: "Good", 5: "Great" };

export interface CheckIn {
  date: string; // YYYY-MM-DD in Toronto
  energy: Energy;
  sleep: number | null; // hours slept last night
  note: string;
  reply: string; // the coach's answer, kept so the Today page doesn't call Gemini again
  at: string;
}

export interface FocusSession {
  id: string;
  date: string;
  at: string; // when it ended
  assignmentId: string;
  courseCode: string;
  title: string;
  plannedMinutes: number; // the block's length before your pace was applied
  minutes: number; // focused minutes actually spent
  completed: boolean; // finished what the block was for
}

export const toEnergy = (n: unknown): Energy => Math.min(5, Math.max(1, Math.round(Number(n) || 3))) as Energy;

// ---------- Today's capacity ----------

// How much of today's usual hours to plan, from energy and sleep. Never more than a small bump,
// because a great day is not a reason to cram.
export function capacityFactor(c: Pick<CheckIn, "energy" | "sleep"> | null): { factor: number; reason: string } {
  if (!c) return { factor: 1, reason: "" };
  let factor = { 1: 0.3, 2: 0.6, 3: 0.85, 4: 1, 5: 1.1 }[c.energy];
  let reason = c.energy < 4 ? `${ENERGY_LABEL[c.energy].toLowerCase()} energy` : "";
  if (c.sleep != null && c.sleep < 5) {
    factor = Math.min(factor, 0.5);
    reason = `${c.sleep}h of sleep`;
  } else if (c.sleep != null && c.sleep < 6.5) {
    factor = Math.min(factor, 0.8);
    reason = reason ? `${reason}, short sleep` : "short sleep";
  }
  return { factor, reason: reason ? `Lighter: ${reason}` : "" };
}

// ---------- Learned pace ----------

export interface Pace {
  courseCode: string;
  factor: number; // 1.3 means you take 30% longer than planned
  sessions: number;
}

// Each course's pace from finished focus blocks: actual minutes over planned minutes. The
// estimate is shrunk toward 1 (as if you'd already done an hour exactly on plan), so a single
// slow evening can't double every future plan, and it's clamped to a sane range.
const PRIOR_MINUTES = 60;

export function learnPace(sessions: FocusSession[]): Record<string, Pace> {
  const by = new Map<string, FocusSession[]>();
  for (const s of sessions) {
    if (!s.completed || s.plannedMinutes < 10 || s.minutes < 5) continue;
    by.set(s.courseCode, [...(by.get(s.courseCode) ?? []), s]);
  }
  const out: Record<string, Pace> = {};
  for (const [courseCode, list] of by) {
    const recent = [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
    const actual = recent.reduce((n, s) => n + s.minutes, 0);
    const planned = recent.reduce((n, s) => n + s.plannedMinutes, 0);
    const factor = Math.min(2, Math.max(0.6, (actual + PRIOR_MINUTES) / (planned + PRIOR_MINUTES)));
    out[courseCode] = { courseCode, factor: Math.round(factor * 100) / 100, sessions: recent.length };
  }
  return out;
}

// Only courses with enough evidence change the plan.
export const paceFactors = (pace: Record<string, Pace>) =>
  Object.fromEntries(Object.values(pace).filter((p) => p.sessions >= 2 && Math.abs(p.factor - 1) >= 0.05).map((p) => [p.courseCode, p.factor]));

// ---------- Burnout risk ----------

export type RiskLevel = "low" | "moderate" | "high";

export interface Burnout {
  score: number; // 0-100
  level: RiskLevel;
  drivers: string[]; // what's pushing it up, biggest first
  energy: number | null; // 7-day average
  sleep: number | null;
}

const PRESSURE_POINTS: Record<Pressure, number> = { calm: 0, busy: 8, crunch: 18, overloaded: 25 };

// A transparent score, not a diagnosis: low energy, short sleep and an overfull week each add
// points, and the drivers say exactly which. Catching the trend early is the point.
export function burnoutRisk(checkins: CheckIn[], plan: Plan, sessions: FocusSession[], today: string): Burnout {
  const week = checkins.filter((c) => c.date <= today && daysAgo(c.date, today) < 7);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null);
  const energy = avg(week.map((c) => c.energy));
  const sleep = avg(week.map((c) => c.sleep).filter((s): s is number => s != null));
  const late = sessions.filter((s) => daysAgo(s.date, today) < 7 && torontoHour(s.at) >= 0 && torontoHour(s.at) < 5).length;

  const parts: [number, string][] = [
    [energy != null && energy < 4 ? ((4 - energy) / 3) * 35 : 0, `Energy has averaged ${energy}/5 this week`],
    [sleep != null && sleep < 7 ? Math.min(25, (7 - sleep) * 10) : 0, `Averaging ${sleep}h of sleep`],
    [PRESSURE_POINTS[plan.pressure], plan.pressure === "overloaded" ? "More work than hours before some deadlines" : "A heavy week ahead"],
    [plan.restDay ? 0 : 10, "No light day in the next 7 days"],
    [plan.fullDays >= 4 ? 5 : 0, `${plan.fullDays} full days this week`],
    [Math.min(10, late * 4), `${late} focus session${late === 1 ? "" : "s"} after midnight`],
  ];
  const drivers = parts.filter(([p]) => p >= 4).sort((a, b) => b[0] - a[0]);
  const score = Math.min(100, Math.round(parts.reduce((n, [p]) => n + p, 0)));
  return { score, level: score >= 55 ? "high" : score >= 28 ? "moderate" : "low", drivers: drivers.map(([, d]) => d), energy, sleep };
}

export const RISK_LABEL: Record<RiskLevel, string> = { low: "Low strain", moderate: "Rising strain", high: "Burnout risk" };

// ---------- Helpers ----------

export function daysAgo(day: string, today: string) {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000);
}

const torontoHour = (iso: string) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Toronto", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));

// Minutes of focus per day for the last n days, oldest first.
export function focusByDay(sessions: FocusSession[], today: string, n = 7) {
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i;
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    return { date: d, minutes: sessions.filter((s) => s.date === d).reduce((m, s) => m + s.minutes, 0) };
  });
}
