import type { Settings } from "./store";
import type { StudyTask } from "./study";
import type { Assignment, Progress } from "./types";

// Turns open assignments into a day-by-day work plan that respects how many
// hours a day you can study, and flags days and deadlines that won't fit.

const TZ = "America/Toronto";
const DAY = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 21;

export interface PlanItem {
  kind: "assignment" | "study"; // study: understanding a concept the assignment needs
  href: string;
  assignmentId: string;
  name: string;
  courseCode: string;
  title: string;
  hours: number;
  dueAt: string | null;
}

export interface PlanDay {
  key: string; // YYYY-MM-DD in Toronto
  label: string;
  weekend: boolean;
  capacity: number;
  note: string; // why capacity differs from the usual, set by the Planner agent
  load: number;
  items: PlanItem[];
}

export interface Risk {
  assignmentId: string;
  name: string;
  courseCode: string;
  dueAt: string | null;
  overflowHours: number;
  overdue: boolean;
}

export type Pressure = "calm" | "busy" | "crunch" | "overloaded";

export interface Plan {
  days: PlanDay[];
  risks: Risk[];
  next7Hours: number;
  next7Capacity: number;
  pressure: Pressure;
  fullDays: number; // days in the next week at 90%+ of capacity
  restDay: boolean; // at least one day in the next week with under an hour of work
  guessed: number; // open assignments whose hours are a rough guess, not an estimate
  openCount: number;
}

export const dayKey = (d: Date | number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const hourIn = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));

const dayLabel = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d);

const isWeekend = (d: Date) => ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d));

const round = (h: number) => Math.round(h * 4) / 4;

// Rough hours when there's no estimate yet, from the assignment's name and type.
export function guessHours(a: Assignment): number {
  const n = a.name.toLowerCase();
  if (a.submissionTypes.includes("online_quiz") || /\bquiz\b/.test(n)) return 1;
  if (a.submissionTypes.includes("discussion_topic") || /reflection|discussion|response/.test(n)) return 1.5;
  if (/final|project|essay|paper|report|proposal/.test(n)) return 8;
  if (/lab|problem set|assignment|homework|\bps\d*|exercise/.test(n)) return 4;
  return 3;
}

export const isOpen = (a: Assignment, p: Progress) => !a.submitted && p.status !== "done";

export function buildPlan(
  assignments: Assignment[],
  progress: Record<string, Progress>,
  settings: Settings,
  study: Record<string, StudyTask[]> = {}, // concepts each assignment still needs, by assignment id
  now = new Date(),
): Plan {
  const days: PlanDay[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = new Date(now.getTime() + i * DAY);
    const weekend = isWeekend(d);
    const key = dayKey(d);
    const override = settings.overrides?.[key];
    let capacity = override ? override.hours : weekend ? settings.weekendHours : settings.weekdayHours;
    // Late in the day, today only has the evening left.
    if (i === 0) capacity = Math.min(capacity, Math.max(0, 23 - hourIn(now)));
    days.push({ key, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayLabel(d), weekend, capacity, note: override?.reason ?? "", load: 0, items: [] });
  }
  const lastKey = days[days.length - 1].key;

  let guessed = 0;
  const open = assignments
    .filter((a) => isOpen(a, progress[a.id]) && a.dueAt && dayKey(new Date(a.dueAt)) <= lastKey)
    .sort((x, y) => new Date(x.dueAt!).getTime() - new Date(y.dueAt!).getTime());

  const risks: Risk[] = [];
  for (const a of open) {
    const p = progress[a.id];
    const due = new Date(a.dueAt!);
    const overdue = due.getTime() < now.getTime();
    // Work must be done by the day before a morning deadline, or the same day for later ones.
    let lastIdx = days.findIndex((d) => d.key === dayKey(due));
    if (hourIn(due) < 12) lastIdx -= 1;
    if (overdue || lastIdx < 0) lastIdx = 0;

    // Understanding the concepts comes first, then the work itself.
    const tasks: { title: string; hours: number; href?: string }[] = [
      ...(study[a.id] ?? []),
      ...(p.steps.length
        ? p.steps.filter((s) => !s.done).map((s) => ({ title: s.title, hours: s.hours }))
        : [{ title: "Keep working", hours: (p.estimateHours ?? guessHours(a)) * (1 - p.percent / 100) }]),
    ];
    if (!p.steps.length && p.estimateHours == null) guessed++;

    let overflow = 0;
    for (const t of tasks) {
      let left = round(t.hours);
      for (let i = 0; i <= lastIdx && left > 0; i++) {
        const free = round(days[i].capacity - days[i].load);
        if (free < 0.25) continue;
        const take = Math.min(left, free);
        place(days[i], a, t.title, take, t.href);
        left = round(left - take);
      }
      if (left > 0) {
        // Doesn't fit before the deadline: put it on the last possible day and flag it.
        place(days[lastIdx], a, t.title, left, t.href);
        overflow += left;
      }
    }
    if (overflow > 0 || overdue) {
      risks.push({ assignmentId: a.id, name: a.name, courseCode: a.courseCode, dueAt: a.dueAt, overflowHours: round(overflow), overdue });
    }
  }

  const week = days.slice(0, 7);
  const next7Hours = round(week.reduce((n, d) => n + d.load, 0));
  const next7Capacity = round(week.reduce((n, d) => n + d.capacity, 0));
  const fullDays = week.filter((d) => d.capacity > 0 && d.load >= d.capacity * 0.9).length;
  const ratio = next7Capacity ? next7Hours / next7Capacity : next7Hours > 0 ? 2 : 0;
  const pressure: Pressure =
    risks.some((r) => r.overflowHours > 0) ? "overloaded" : ratio > 0.85 || fullDays >= 4 ? "crunch" : ratio > 0.5 ? "busy" : "calm";

  return {
    days,
    risks,
    next7Hours,
    next7Capacity,
    pressure,
    fullDays,
    restDay: week.some((d) => d.load < 1),
    guessed,
    openCount: open.length,
  };
}

function place(day: PlanDay, a: Assignment, title: string, hours: number, studyHref?: string) {
  day.load = round(day.load + hours);
  const same = day.items.find((it) => it.assignmentId === a.id && it.title === title);
  if (same) same.hours = round(same.hours + hours);
  else
    day.items.push({
      kind: studyHref ? "study" : "assignment",
      href: studyHref ?? `/a/${a.id}`,
      assignmentId: a.id,
      name: a.name,
      courseCode: a.courseCode,
      title,
      hours,
      dueAt: a.dueAt,
    });
}

export const PRESSURE_LABEL: Record<Pressure, string> = {
  calm: "Calm week",
  busy: "Busy week",
  crunch: "Crunch week",
  overloaded: "Overloaded",
};

export const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : `${Number.isInteger(h) ? h : h.toFixed(h * 4 % 2 ? 2 : 1)}h`);
