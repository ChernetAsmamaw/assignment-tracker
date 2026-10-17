import { NextResponse } from "next/server";
import { route } from "@/lib/agents/router";
import { applyInstruction } from "@/lib/agents/planner";
import { createStudyPlan } from "@/lib/agents/study";
import { loadAll } from "@/lib/data";
import { fmtHours, PRESSURE_LABEL } from "@/lib/planner";
import { getSettings, listAll, putOne, saveSettings } from "@/lib/store";
import type { Mastery } from "@/lib/types";

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
  if (r.agent === "study") {
    const exam = new Date(`${r.examDate}T09:00:00-04:00`);
    if (!r.examDate || isNaN(exam.getTime()) || exam.getTime() < Date.now()) {
      const q = new URLSearchParams({ course: r.courseCode, title: r.title, topics: r.topics.join(", ") });
      return NextResponse.json({ agent: "Study Plan", message: "When is the exam? Add the date and I'll build the timeline.", href: `/study?${q}` });
    }
    const plan = await createStudyPlan(
      { title: r.title, courseCode: r.courseCode, examAt: exam.toISOString(), topics: r.topics, notes: text },
      assignments.filter((a) => a.courseCode === r.courseCode),
      await listAll<Mastery>("mastery"),
    );
    await putOne("studyplans", plan.id, plan);
    return NextResponse.json({ agent: "Study Plan", message: `Built a ${plan.sessions.length}-session plan for ${plan.courseCode} ${plan.title}.`, href: `/study/${plan.id}` });
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
