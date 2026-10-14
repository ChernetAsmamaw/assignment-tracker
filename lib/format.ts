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
