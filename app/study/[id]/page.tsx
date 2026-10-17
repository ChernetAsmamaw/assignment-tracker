import Link from "next/link";
import { notFound } from "next/navigation";
import { getOne } from "@/lib/store";
import { formatDue } from "@/lib/format";
import { dayKey } from "@/lib/planner";
import type { StudyPlan } from "@/lib/types";
import Timeline from "./Timeline";

export const dynamic = "force-dynamic";

export default async function StudyPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getOne<StudyPlan>("studyplans", id);
  if (!plan) notFound();
  const days = Math.ceil((new Date(plan.examAt).getTime() - Date.now()) / 864e5);
  const minutes = plan.sessions.reduce((n, s) => n + s.minutes, 0);
  return (
    <>
      <p className="small"><Link href="/study">← Study plans</Link></p>
      <header className="page-head">
        <div>
          <span className="eyebrow">{plan.courseCode} · {formatDue(plan.examAt)}</span>
          <h1>{plan.title}</h1>
          <p>{days > 0 ? `${days} day${days === 1 ? "" : "s"} to go` : "Exam day has passed"} · {plan.sessions.length} sessions · {Math.round(minutes / 60)}h total</p>
        </div>
      </header>
      <div className="card coach">
        <span className="ai-badge">✦ Strategy</span>
        <p style={{ margin: "8px 0 6px" }}>{plan.summary}</p>
        <p className="muted small" style={{ margin: 0 }}>Topics, weakest first: {plan.topics.join(" · ")}</p>
      </div>
      <Timeline plan={plan} today={dayKey(new Date())} examDay={dayKey(new Date(plan.examAt))} />
    </>
  );
}
