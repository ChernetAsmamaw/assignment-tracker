const TZ = "America/Toronto";

export function formatDue(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  return new Date(dueAt).toLocaleString("en-CA", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeDue(dueAt: string | null): string {
  if (!dueAt) return "";
  const hours = (new Date(dueAt).getTime() - Date.now()) / 36e5;
  if (hours < 0) return hours > -24 ? "overdue" : `${Math.round(-hours / 24)}d overdue`;
  if (hours < 24) return `in ${Math.max(1, Math.round(hours))}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export type Urgency = "overdue" | "urgent" | "soon" | "later" | "none";

// Big countdown shown on each card, e.g. { value: "3", label: "days left" }.
export function countdown(dueAt: string | null): { value: string; label: string; urgency: Urgency } {
  if (!dueAt) return { value: "–", label: "no due date", urgency: "none" };
  const hours = (new Date(dueAt).getTime() - Date.now()) / 36e5;
  if (hours < 0) {
    const d = Math.floor(-hours / 24);
    return d >= 1
      ? { value: String(d), label: d === 1 ? "day overdue" : "days overdue", urgency: "overdue" }
      : { value: String(Math.max(1, Math.round(-hours))), label: "hours overdue", urgency: "overdue" };
  }
  if (hours < 48) {
    const h = Math.max(1, Math.round(hours));
    return { value: String(h), label: h === 1 ? "hour left" : "hours left", urgency: "urgent" };
  }
  const d = Math.round(hours / 24);
  return { value: String(d), label: "days left", urgency: d <= 7 ? "soon" : "later" };
}
