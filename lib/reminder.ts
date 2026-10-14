import { Resend } from "resend";
import { getAssignments } from "./canvas";
import { getAllProgress } from "./store";
import { formatDue, relativeDue } from "./format";
import { STATUS_LABEL, type Assignment, type Progress } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export async function buildReminder() {
  const days = Number(process.env.REMIND_DAYS || 3);
  const [assignments, progress] = await Promise.all([getAssignments(), getAllProgress()]);
  const now = Date.now();

  const pending = assignments.filter((a) => {
    if (!a.dueAt || a.submitted || progress[a.id]?.status === "done") return false;
    const t = new Date(a.dueAt).getTime();
    return t > now - DAY && t < now + (days + 0.5) * DAY;
  });

  return { pending, progress, days };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function renderEmail(pending: Assignment[], progress: Record<string, Progress>, days: number) {
  const app = (process.env.APP_URL || "").replace(/\/$/, "");
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
    <h2 style="margin:0 0 4px">You have ${pending.length} assignment${pending.length === 1 ? "" : "s"} due soon</h2>
    <p style="color:#555;margin:0 0 12px">Everything due in the next ${days} days that isn't submitted or marked done.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${app ? `<p style="margin-top:16px"><a href="${esc(app)}">Open your tracker</a></p>` : ""}
  </div>`;
  const text = pending.map((a) => `- ${a.name} (${a.courseCode}), due ${formatDue(a.dueAt)}`).join("\n");
  const first = pending[0];
  const subject =
    pending.length === 1
      ? `Due ${relativeDue(first.dueAt)}: ${first.name}`
      : `${pending.length} assignments due soon (next: ${first.name}, ${relativeDue(first.dueAt)})`;
  return { subject, html, text };
}

export async function sendReminder() {
  const { pending, progress, days } = await buildReminder();
  if (pending.length === 0) return { sent: false, count: 0 };

  const { subject, html, text } = renderEmail(pending, progress, days);
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
