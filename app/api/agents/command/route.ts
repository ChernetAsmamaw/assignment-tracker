import { NextResponse } from "next/server";
import { route } from "@/lib/agents/router";
import { applyInstruction } from "@/lib/agents/planner";
import { loadAll } from "@/lib/data";
import { fmtHours, PRESSURE_LABEL } from "@/lib/planner";
import { getSettings, saveSettings } from "@/lib/store";
import { studyHref } from "@/lib/study";
import { recordCheckIn } from "@/lib/agents/wellbeing";

export const maxDuration = 60;

// Routes a free-text request to the right agent and runs it.
export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "Type a request" }, { status: 400 });
  const { assignments, plan } = await loadAll();
  const context = [
    `This week: ${PRESSURE_LABEL[plan.pressure]}, ${fmtHours(plan.next7Hours)} of ${fmtHours(plan.next7Capacity)} planned.`,
    `Today's plan: ${plan.days[0].items.map((i) => `${fmtHours(i.hours)} ${i.title} (${i.courseCode} ${i.name})`).join("; ") || "nothing"}.`,
    plan.risks.length ? `At risk: ${plan.risks.map((r) => r.name).join(", ")}.` : "",
  ].join("\n");
  const r = await route(text.trim(), assignments, context);

  if (r.agent === "planner") {
    const result = await applyInstruction(r.instruction, await getSettings());
    await saveSettings(result.settings);
    return NextResponse.json({ agent: "Planner", message: result.reply, href: "/plan" });
  }
  if (r.agent === "checkin") {
    const { checkin, capacity } = await recordCheckIn(r);
    return NextResponse.json({ agent: "Wellbeing", message: `${checkin.reply} Today is now ${fmtHours(capacity)}.`, href: "/" });
  }
  if (r.agent === "study") {
    const code = assignments.find((a) => a.courseCode.toLowerCase() === r.courseCode.toLowerCase())?.courseCode;
    return code
      ? NextResponse.json({ agent: "Study", message: `Opening your ${code} notes.`, href: studyHref(code) })
      : NextResponse.json({ agent: "Study", message: "Opening Study. Pick a course to see its notes.", href: "/study" });
  }
  if (r.agent === "quiz") {
    const q = new URLSearchParams({ course: r.courseCode, topic: r.topic });
    return NextResponse.json({ agent: "Performance", message: r.topic ? `Opening a quiz on ${r.topic}.` : "Pick a topic to quiz on.", href: `/performance?${q}` });
  }
  if (r.agent === "open") {
    const a = assignments.find((x) => x.id === r.assignmentId);
    return NextResponse.json({ agent: "Assignments", message: `Opening ${a?.name ?? "the assignment"}.`, href: `/a/${r.assignmentId}` });
  }
  return NextResponse.json({ agent: "Pace", message: r.text });
}
