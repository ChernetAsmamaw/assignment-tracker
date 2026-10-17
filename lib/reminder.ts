import { Resend } from "resend";
import { loadAll } from "./data";
import { formatDue, relativeDue } from "./format";
import { fmtHours, PRESSURE_LABEL, type Plan } from "./planner";
import { STATUS_LABEL, type Assignment, type Progress } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export async function buildReminder() {
  const days = Number(process.env.REMIND_DAYS || 3);
  const { assignments, progress, plan } = await loadAll();
  const now = Date.now();

  const pending = assignments.filter((a) => {
    if (!a.dueAt || a.submitted || progress[a.id]?.status === "done") return false;
    const t = new Date(a.dueAt).getTime();
    return t > now - DAY && t < now + (days + 0.5) * DAY;
  });

  return { pending, progress, days, plan };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function renderEmail(pending: Assignment[], progress: Record<string, Progress>, days: number, plan?: Plan) {
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
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
    ${todayHtml}
    ${pending.length ? `<h2 style="margin:0 0 4px">You have ${pending.length} assignment${pending.length === 1 ? "" : "s"} due soon</h2>
    <p style="color:#555;margin:0 0 12px">Everything due in the next ${days} days that isn't submitted or marked done.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>` : ""}
    ${app ? `<p style="margin-top:16px"><a href="${esc(app)}">Open your tracker</a></p>` : ""}
  </div>`;
  const text = [
    ...(today?.items.length ? ["Today's plan:", ...today.items.map((i) => `- ${fmtHours(i.hours)} ${i.title} (${i.courseCode} ${i.name})`), ""] : []),
    ...pending.map((a) => `- ${a.name} (${a.courseCode}), due ${formatDue(a.dueAt)}`)].join("\n");
  const first = pending[0];
  const subject = !first
    ? `Today's plan: ${fmtHours(today?.load ?? 0)} of study`
    : pending.length === 1
      ? `Due ${relativeDue(first.dueAt)}: ${first.name}`
      : `${pending.length} assignments due soon (next: ${first.name}, ${relativeDue(first.dueAt)})`;
  return { subject, html, text };
}

export async function sendReminder() {
  const { pending, progress, days, plan } = await buildReminder();
  if (pending.length === 0 && plan.days[0].items.length === 0) return { sent: false, count: 0 };

  const { subject, html, text } = renderEmail(pending, progress, days, plan);
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
