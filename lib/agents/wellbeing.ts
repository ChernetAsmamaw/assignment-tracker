import { loadAll } from "../data";
import { gemini, hasGemini } from "../gemini";
import { fmtHours, type Plan } from "../planner";
import { putOne } from "../store";
import { burnoutRisk, ENERGY_LABEL, RISK_LABEL, toEnergy, type Burnout, type CheckIn, type Pace } from "../wellbeing";

// Wellbeing agent: answers the morning check-in and watches for burnout. The numbers
// (today's capacity, the risk score, your pace) come from lib/wellbeing; Gemini only
// explains them and suggests what to keep and what to let go.

const SYSTEM =
  "You are Pace, a warm, practical wellbeing coach for a university student. You care about sleep, rest and sustainable work more than squeezing in hours. " +
  "You are brief and specific, never preachy, and you never give medical advice; if the student sounds in crisis you point them to campus mental health services or a crisis line.";

const agendaText = (plan: Plan) =>
  plan.days[0].items.map((i) => `${fmtHours(i.hours)} ${i.title} (${i.courseCode} ${i.name})`).join("; ") || "nothing";

// Saves today's check-in, replans with it, then answers. Used by the Today card and the command bar.
export async function recordCheckIn(input: { energy?: unknown; sleep?: unknown; note?: unknown }) {
  const { today } = await loadAll();
  const sleepN = Number(input.sleep);
  const c: CheckIn = {
    date: today,
    energy: toEnergy(input.energy),
    sleep: input.sleep == null || input.sleep === "" || !Number.isFinite(sleepN) ? null : Math.min(14, Math.max(0, Math.round(sleepN * 2) / 2)),
    note: String(input.note ?? "").slice(0, 600),
    reply: "",
    at: new Date().toISOString(),
  };
  await putOne("checkins", c.date, c);
  const { plan, checkins, sessions } = await loadAll();
  c.reply = await checkInReply(c, plan, burnoutRisk(checkins, plan, sessions, today));
  await putOne("checkins", c.date, c);
  return { checkin: c, capacity: plan.days[0].capacity };
}

// One or two sentences for the Today page right after a check-in.
export async function checkInReply(c: Pick<CheckIn, "energy" | "sleep" | "note">, plan: Plan, risk: Burnout): Promise<string> {
  const today = plan.days[0];
  if (hasGemini()) {
    try {
      const { data } = await gemini<{ reply: string }>({
        system: SYSTEM,
        prompt:
          `Check-in: energy ${c.energy}/5 (${ENERGY_LABEL[c.energy]}), sleep ${c.sleep ?? "not given"}h${c.note ? `, they said: "${c.note.slice(0, 400)}"` : ""}.\n` +
          `The planner has already set today to ${fmtHours(today.capacity)} of study${today.note ? ` (${today.note})` : ""}. Today's plan: ${agendaText(plan)}.\n` +
          `Strain this week: ${RISK_LABEL[risk.level]} (${risk.score}/100${risk.drivers.length ? `; ${risk.drivers.join("; ")}` : ""}).\n\n` +
          "Reply in at most 2 short sentences: acknowledge how they feel, name the one block to do first today, and one small thing for their wellbeing (a break, a walk, an early night).",
        schema: { type: "OBJECT", properties: { reply: { type: "STRING" } }, required: ["reply"] },
        temperature: 0.6,
        fast: true,
      });
      if (data.reply) return data.reply.slice(0, 400);
    } catch (e) {
      console.error("check-in reply", e);
    }
  }
  const first = today.items[0];
  const start = first ? `Start with ${first.courseCode} ${first.name}${first.title === "Keep working" ? "" : `: ${first.title}`}.` : "Nothing is planned, so take the rest.";
  if (c.energy <= 2) return `Thanks for being honest. I trimmed today to ${fmtHours(today.capacity)} and moved the rest later. ${start} Stop early tonight.`;
  if (c.energy >= 4) return `Good energy. ${start} Take a 5 minute break every 25 minutes so it lasts.`;
  return `${start} Your plan for today is ${fmtHours(today.load)}.`;
}

export interface WellbeingNote {
  headline: string;
  message: string;
  actions: string[];
  ai: boolean;
}

// The coaching note on the Wellbeing page.
export async function wellbeingNote(risk: Burnout, plan: Plan, pace: Pace[], focusMinutes: number): Promise<WellbeingNote> {
  const facts = [
    `Strain score ${risk.score}/100 (${RISK_LABEL[risk.level]}). Drivers: ${risk.drivers.join("; ") || "none"}.`,
    `7-day average energy ${risk.energy ?? "unknown"}/5, sleep ${risk.sleep ?? "unknown"}h.`,
    `Next 7 days: ${fmtHours(plan.next7Hours)} planned of ${fmtHours(plan.next7Capacity)} available, ${plan.fullDays} full days, ${plan.restDay ? "has" : "no"} light day, ${plan.risks.length} assignments at risk.`,
    `Focused ${Math.round(focusMinutes / 6) / 10}h in the last 7 days.`,
    pace.length ? `Learned pace: ${pace.map((p) => `${p.courseCode} ${p.factor}x estimates over ${p.sessions} sessions`).join(", ")}.` : "",
  ].join("\n");

  if (hasGemini()) {
    try {
      const { data } = await gemini<Omit<WellbeingNote, "ai">>({
        system: SYSTEM,
        prompt:
          `${facts}\n\nWrite a headline (under 9 words), a 2 sentence message that explains what the numbers say, and up to 3 concrete actions for this week ` +
          "(for example: protect a rest day, move a block off a late night, ask for an extension early, plan more time for a course where they run slow). Use only the numbers given.",
        schema: {
          type: "OBJECT",
          properties: { headline: { type: "STRING" }, message: { type: "STRING" }, actions: { type: "ARRAY", items: { type: "STRING" } } },
          required: ["headline", "message", "actions"],
        },
        fast: true,
      });
      return { headline: data.headline, message: data.message, actions: (data.actions ?? []).slice(0, 3), ai: true };
    } catch (e) {
      console.error("wellbeing note", e);
    }
  }

  const actions: string[] = [];
  if (!plan.restDay) actions.push("Pick one evening this week with no study and tell the planner, e.g. \"keep Sunday free\".");
  if (risk.sleep != null && risk.sleep < 7) actions.push("Aim for 7+ hours tonight; stop studying an hour before bed.");
  const slow = [...pace].sort((a, b) => b.factor - a.factor)[0];
  if (slow && slow.factor > 1.15) actions.push(`You run ${Math.round((slow.factor - 1) * 100)}% over estimates in ${slow.courseCode}; start its work earlier.`);
  if (plan.risks.length) actions.push("Ask about an extension now for anything that won't fit, not the night before.");
  return {
    headline: risk.level === "high" ? "Time to ease off" : risk.level === "moderate" ? "Strain is building" : "You're in a sustainable rhythm",
    message:
      risk.drivers.length
        ? `${risk.drivers.slice(0, 2).map((d, i) => (i ? d[0].toLowerCase() + d.slice(1) : d)).join(", and ")}. Small changes now beat recovering from an all-nighter later.`
        : "Your energy, sleep and workload look balanced. Keep checking in so I can spot changes early.",
    actions: actions.slice(0, 3),
    ai: false,
  };
}
