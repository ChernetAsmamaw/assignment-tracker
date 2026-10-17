import { gemini, hasGemini } from "../gemini";
import { dayKey } from "../planner";
import type { Settings } from "../store";

// Planner agent: turns plain English ("I work Tuesday 5 to 10, gym every Thursday,
// nothing on Sunday") into per-day study hours that the scheduler respects.

const DAY = 24 * 60 * 60 * 1000;
const TZ = "America/Toronto";

export interface ScheduleChange {
  settings: Settings;
  changes: { date: string; hours: number; reason: string }[];
  reply: string;
  ai: boolean;
}

function upcoming(now = new Date()) {
  return Array.from({ length: 21 }, (_, i) => {
    const d = new Date(now.getTime() + i * DAY);
    return { key: dayKey(d), weekday: new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(d) };
  });
}

export async function applyInstruction(instruction: string, settings: Settings): Promise<ScheduleChange> {
  const days = upcoming();
  let changes: ScheduleChange["changes"] = [];
  let reply = "";
  let base: Partial<Pick<Settings, "weekdayHours" | "weekendHours">> = {};
  let ai = false;

  if (hasGemini()) {
    try {
      const { data } = await gemini<{ changes: ScheduleChange["changes"]; weekdayHours: number | null; weekendHours: number | null; reply: string }>({
        system:
          "You manage a student's study-hours calendar. Convert their message into changes. A day's hours are how many hours they can study that day " +
          "(0 to 12). A shift or event reduces that day's hours by its length; 'day off from studying' means 0. Recurring things ('every Thursday') apply to each matching date listed. " +
          "Only change weekdayHours or weekendHours if they describe their usual routine. reply is one friendly sentence confirming what changed.",
        prompt:
          `Usual study hours: weekdays ${settings.weekdayHours}h, weekends ${settings.weekendHours}h.\n` +
          `Upcoming dates:\n${days.map((d) => `${d.key} ${d.weekday}${settings.overrides[d.key] ? ` (currently ${settings.overrides[d.key].hours}h: ${settings.overrides[d.key].reason})` : ""}`).join("\n")}\n\n` +
          `Student says: "${instruction.slice(0, 600)}"`,
        schema: {
          type: "OBJECT",
          properties: {
            changes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { date: { type: "STRING" }, hours: { type: "NUMBER" }, reason: { type: "STRING" } },
                required: ["date", "hours", "reason"],
              },
            },
            weekdayHours: { type: "NUMBER", nullable: true },
            weekendHours: { type: "NUMBER", nullable: true },
            reply: { type: "STRING" },
          },
          required: ["changes", "reply"],
        },
        temperature: 0.2,
      });
      const valid = new Set(days.map((d) => d.key));
      changes = (data.changes ?? []).filter((c) => valid.has(c.date)).map((c) => ({ date: c.date, hours: clamp(c.hours), reason: String(c.reason).slice(0, 80) }));
      if (data.weekdayHours != null) base.weekdayHours = clamp(data.weekdayHours);
      if (data.weekendHours != null) base.weekendHours = clamp(data.weekendHours);
      reply = data.reply ?? "";
      ai = true;
    } catch (e) {
      console.error("planner agent", e);
    }
  }

  if (!ai) {
    // Without Gemini: any weekday named in the message becomes a light day.
    const text = instruction.toLowerCase();
    const off = /\b(off|nothing|no study|rest|free)\b/.test(text);
    changes = days
      .filter((d) => text.includes(d.weekday.toLowerCase()) || (text.includes("tomorrow") && d.key === days[1].key) || (text.includes("today") && d.key === days[0].key))
      .slice(0, 6)
      .map((d) => ({ date: d.key, hours: off ? 0 : 1, reason: instruction.slice(0, 60) }));
    base = {};
    reply = changes.length
      ? `Set ${changes.length} day${changes.length > 1 ? "s" : ""} to ${off ? "no study" : "a light 1h"}.`
      : "I couldn't tell which days you meant. Name a day, like \"busy Tuesday\".";
  }

  const overrides = { ...settings.overrides };
  // Drop overrides for days that have passed.
  for (const k of Object.keys(overrides)) if (k < days[0].key) delete overrides[k];
  for (const c of changes) overrides[c.date] = { hours: c.hours, reason: c.reason };
  return { settings: { ...settings, ...base, overrides }, changes, reply, ai };
}

const clamp = (h: unknown) => Math.min(12, Math.max(0, Math.round((Number(h) || 0) * 2) / 2));
