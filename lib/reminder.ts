import { Resend } from "resend";
import { loadAll } from "./data";
import { formatDue, relativeDue } from "./format";
import { fmtHours, PRESSURE_LABEL, type Plan } from "./planner";
import { STATUS_LABEL, type Assignment, type Progress } from "./types";
import { listOpportunities } from "./careers-store";
import { deadlineInfo, formatDay, isToApply, nextStep, sortPriority, sortRelevance, torontoToday, type Opportunity } from "./careers";

const DAY = 24 * 60 * 60 * 1000;

export async function buildReminder() {
  const days = Number(process.env.REMIND_DAYS || 3);
  const [{ assignments, progress, plan }, opps] = await Promise.all([loadAll(), listOpportunities()]);
  const now = Date.now();

  const pending = assignments.filter((a) => {
    if (!a.dueAt || a.submitted || progress[a.id]?.status === "done") return false;
    const t = new Date(a.dueAt).getTime();
    return t > now - DAY && t < now + (days + 0.5) * DAY;
  });

  return { pending, progress, days, plan, careers: careerDigest(opps) };
}

export interface CareerDigest {
  finds: Opportunity[]; // the Scout's suggestions waiting for review
  deadlines: Opportunity[]; // applications due in the next 10 days
  steps: { o: Opportunity; title: string; due: string }[]; // plan steps due today or overdue
}

export function careerDigest(opps: Opportunity[], today = torontoToday()): CareerDigest {
  const toApply = opps.filter(isToApply);
  return {
    finds: sortRelevance(opps.filter((o) => o.status === "suggested")),
    deadlines: sortPriority(toApply.filter((o) => {
      const d = deadlineInfo(o.deadline, today).days;
      return d != null && d >= 0 && d <= 10;
    })),
    steps: toApply.flatMap((o) => {
      const s = nextStep(o);
      return s && s.due <= today ? [{ o, title: s.title, due: s.due }] : [];
    }),
  };
}

const hasCareerNews = (c?: CareerDigest) => !!c && (c.finds.length > 0 || c.deadlines.length > 0 || c.steps.length > 0);

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function renderEmail(pending: Assignment[], progress: Record<string, Progress>, days: number, plan?: Plan, careers?: CareerDigest) {
  const app = (process.env.APP_URL || "").replace(/\/$/, "");
  const today = plan?.days[0];
  const todayHtml = today?.items.length
    ? `<div style="background:#eef3ff;border-radius:10px;padding:12px 14px;margin:0 0 16px">
        <div style="font-weight:700;margin-bottom:6px">Today's plan · ${fmtHours(today.load)}</div>
        ${today.items
          .map((i) => `<div style="font-size:14px;margin:3px 0"><b>${fmtHours(i.hours)}</b> ${esc(i.title)} <span style="color:#555">· ${esc(i.courseCode)} ${esc(i.name)}</span></div>`)
          .join("")}
        <div style="color:#555;font-size:13px;margin-top:8px">${PRESSURE_LABEL[plan!.pressure]}: ${fmtHours(plan!.next7Hours)} of work this week, ${fmtHours(plan!.next7Capacity)} available.${
          plan!.risks.length ? ` <b style="color:#b42318">${plan!.risks.length} at risk:</b> ${plan!.risks.map((r) => esc(r.name)).join(", ")}.` : ""
        }</div>
      </div>`
    : "";
  const rows = pending
    .map((a) => {
      const p = progress[a.id];
      const state = p ? `${STATUS_LABEL[p.status]} · ${p.percent}%` : "Not started";
      const link = app ? `${app}/a/${a.id}` : a.url;
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee">
          <a href="${esc(link)}" style="color:#1d4ed8;font-weight:600;text-decoration:none">${esc(a.name)}</a><br>
          <span style="color:#555;font-size:13px">${esc(a.courseCode)} · due ${esc(formatDue(a.dueAt))} (${relativeDue(a.dueAt)}) · ${state}</span>
        </td></tr>`;
    })
    .join("");
  const careersHtml = renderCareers(careers, app);
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
    ${todayHtml}
    ${pending.length ? `<h2 style="margin:0 0 4px">You have ${pending.length} assignment${pending.length === 1 ? "" : "s"} due soon</h2>
    <p style="color:#555;margin:0 0 12px">Everything due in the next ${days} days that isn't submitted or marked done.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>` : ""}
    ${careersHtml}
    ${app ? `<p style="margin-top:16px"><a href="${esc(app)}">Open your tracker</a></p>` : ""}
  </div>`;
  const text = [
    ...(today?.items.length ? ["Today's plan:", ...today.items.map((i) => `- ${fmtHours(i.hours)} ${i.title} (${i.courseCode} ${i.name})`), ""] : []),
    ...pending.map((a) => `- ${a.name} (${a.courseCode}), due ${formatDue(a.dueAt)}`),
    ...(careers?.finds.length ? ["", `The Scout found ${careers.finds.length} new opportunit${careers.finds.length === 1 ? "y" : "ies"} to review:`, ...careers.finds.slice(0, 5).map((o) => `- ${o.title}, ${o.organization} (${o.relevance}% fit)`)] : []),
    ...(careers?.deadlines.length ? ["", "Application deadlines:", ...careers.deadlines.map((o) => `- ${o.organization}, ${o.title}: ${formatDay(o.deadline)}`)] : []),
  ].join("\n");
  const first = pending[0];
  const subject = !first
    ? !today?.items.length && careers?.finds.length
      ? `${careers.finds.length} new internship${careers.finds.length === 1 ? "" : "s"} to review`
      : `Today's plan: ${fmtHours(today?.load ?? 0)} of study`
    : pending.length === 1
      ? `Due ${relativeDue(first.dueAt)}: ${first.name}`
      : `${pending.length} assignments due soon (next: ${first.name}, ${relativeDue(first.dueAt)})`;
  return { subject, html, text };
}

export async function sendReminder() {
  const { pending, progress, days, plan, careers } = await buildReminder();
  if (pending.length === 0 && plan.days[0].items.length === 0 && !hasCareerNews(careers)) return { sent: false, count: 0 };

  const { subject, html, text } = renderEmail(pending, progress, days, plan, careers);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.REMINDER_FROM || "Assignment Tracker <onboarding@resend.dev>",
    to: process.env.REMINDER_TO!,
    subject,
    html,
    text,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return { sent: true, count: pending.length, subject };
}

function renderCareers(c: CareerDigest | undefined, app: string): string {
  if (!hasCareerNews(c)) return "";
  const link = (o: Opportunity) => (app ? `${app}/careers/${o.id}` : o.url);
  const finds = c!.finds.length
    ? `<div style="background:#eaf4ff;border-radius:10px;padding:12px 14px;margin:0 0 12px">
        <div style="font-weight:700;margin-bottom:4px">The Scout found ${c!.finds.length} new opportunit${c!.finds.length === 1 ? "y" : "ies"}. Want to review ${c!.finds.length === 1 ? "it" : "them"}?</div>
        ${c!.finds
          .slice(0, 5)
          .map((o) => `<div style="font-size:14px;margin:6px 0"><a href="${esc(link(o))}" style="color:#1d4ed8;font-weight:600;text-decoration:none">${esc(o.title)}</a> · ${esc(o.organization)}${o.location ? `, ${esc(o.location)}` : ""}<br><span style="color:#555;font-size:13px">${o.relevance}% fit${o.deadline ? ` · apply by ${esc(formatDay(o.deadline))}` : ""}${o.whyRelevant ? ` · ${esc(o.whyRelevant)}` : ""}</span></div>`)
          .join("")}
        ${app ? `<a href="${esc(app)}/careers" style="display:inline-block;margin-top:6px;font-weight:600">Review and add →</a>` : ""}
      </div>`
    : "";
  const deadlines = c!.deadlines.length
    ? `<div style="font-weight:700;margin:12px 0 4px">Application deadlines</div>
      ${c!.deadlines.map((o) => `<div style="font-size:14px;margin:3px 0">${o.priority ? "★ " : ""}<a href="${esc(link(o))}" style="color:#1d4ed8;text-decoration:none">${esc(o.organization)}, ${esc(o.title)}</a> <span style="color:#555">· ${esc(formatDay(o.deadline))} (${esc(deadlineInfo(o.deadline).label.toLowerCase())})</span></div>`).join("")}`
    : "";
  const steps = c!.steps.length
    ? `<div style="font-weight:700;margin:12px 0 4px">Application steps for today</div>
      ${c!.steps.map((s) => `<div style="font-size:14px;margin:3px 0">${esc(s.title)} <span style="color:#555">· ${esc(s.o.organization)}${s.due < torontoToday() ? ' · <b style="color:#b42318">overdue</b>' : ""}</span></div>`).join("")}`
    : "";
  return `<div style="margin-top:20px;padding-top:12px;border-top:1px solid #eee">${finds}${deadlines}${steps}</div>`;
}
