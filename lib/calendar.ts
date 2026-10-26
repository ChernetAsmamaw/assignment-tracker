import type { Plan } from "./planner";
import type { Assignment } from "./types";

// Turns the plan into an iCalendar feed that Google Calendar, Outlook and Apple Calendar can
// subscribe to. Each day's blocks are laid end to end from your usual start time, with a short
// break between them, and every deadline gets its own event.

const TZ = "America/Toronto";
const BREAK_MIN = 10;

// The UTC instant for a wall-clock time in Toronto, handling daylight saving.
export function torontoTime(day: string, hour: number, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, Number(x.value)]),
    );
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t -= shown - Date.UTC(y, m - 1, d, hour, minute);
  }
  return new Date(t);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

// Lines over 75 octets must be folded (RFC 5545).
const fold = (line: string) => {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? " " : "") + line.slice(i, i + 73));
  return out.join("\r\n");
};

export function planToIcs(plan: Plan, assignments: Assignment[], startHour: number, origin: string): string {
  const now = stamp(new Date());
  const events: string[][] = [];

  for (const day of plan.days) {
    let at = torontoTime(day.key, startHour).getTime();
    if (day.label === "Today") at = Math.max(at, Math.ceil(Date.now() / 900_000) * 900_000);
    for (const it of day.items) {
      const end = at + Math.round(it.hours * 60) * 60_000;
      events.push([
        `UID:${day.key}-${it.assignmentId}-${slug(it.title)}@pace`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(new Date(at))}`,
        `DTEND:${stamp(new Date(end))}`,
        `SUMMARY:${esc(`${it.kind === "study" ? "Study" : "Work"} · ${it.courseCode}: ${it.title}`)}`,
        `DESCRIPTION:${esc(`${it.name}\nPlanned by Pace. Open: ${origin}${it.href}`)}`,
        `URL:${origin}${it.href}`,
        "CATEGORIES:Pace study block",
      ]);
      at = end + BREAK_MIN * 60_000;
    }
  }

  const horizon = plan.days[plan.days.length - 1].key;
  for (const a of assignments) {
    if (!a.dueAt || a.submitted) continue;
    const due = new Date(a.dueAt);
    if (due.getTime() < Date.now() - 86_400_000 || due.toISOString().slice(0, 10) > horizon) continue;
    events.push([
      `UID:due-${a.id}@pace`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(new Date(due.getTime() - 30 * 60_000))}`,
      `DTEND:${stamp(due)}`,
      `SUMMARY:${esc(`Due · ${a.courseCode}: ${a.name}`)}`,
      `URL:${a.url}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(`${a.name} is due in 1 day`)}`,
      "TRIGGER:-P1D",
      "END:VALARM",
    ]);
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pace//Study plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Pace study plan",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n");
}
