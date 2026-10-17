"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StudyPlan } from "@/lib/types";

const KIND = { learn: "Learn", review: "Review", practice: "Practice", mock: "Mock exam" } as const;

const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });

export default function Timeline({ plan: initial, today, examDay }: { plan: StudyPlan; today: string; examDay: string }) {
  const [plan, setPlan] = useState(initial);
  const router = useRouter();
  const dates = [...new Set(plan.sessions.map((s) => s.date))].sort();

  const toggle = async (sessionId: string, done: boolean) => {
    setPlan({ ...plan, sessions: plan.sessions.map((s) => (s.id === sessionId ? { ...s, done } : s)) });
    await fetch(`/api/study/${plan.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, done }) });
  };
  const remove = async () => {
    if (!confirm("Delete this study plan?")) return;
    await fetch(`/api/study/${plan.id}`, { method: "DELETE" });
    router.push("/study");
    router.refresh();
  };

  return (
    <>
      <div className="timeline" style={{ marginTop: 20 }}>
        {dates.map((d) => (
          <div key={d} className={`tl-day ${d < today ? "past" : ""}`}>
            <div className="tl-date">{d === today ? "Today" : label(d)}</div>
            {plan.sessions.filter((s) => s.date === d).map((s) => (
              <div key={s.id} className={`session ${s.done ? "done" : ""}`}>
                <input type="checkbox" checked={s.done} onChange={(e) => toggle(s.id, e.target.checked)} aria-label="Done" />
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`kind-tag kind-${s.kind}`}>{KIND[s.kind]}</span>
                    <strong>{s.topics.join(", ")}</strong>
                  </div>
                  <ul>{s.activities.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
                <span className="muted small" style={{ whiteSpace: "nowrap" }}>{s.minutes} min</span>
              </div>
            ))}
          </div>
        ))}
        <div className="tl-day exam">
          <div className="tl-date" style={{ color: "var(--danger)" }}>{label(examDay)} · Exam</div>
          <p className="small muted" style={{ margin: 0 }}>
            Sleep well the night before. <Link href={`/performance?course=${encodeURIComponent(plan.courseCode)}&topic=${encodeURIComponent(plan.topics[0] ?? "")}`}>Quiz yourself</Link> to check you&apos;re ready.
          </p>
        </div>
      </div>
      <p style={{ marginTop: 24 }}><button type="button" className="link small" onClick={remove}>Delete plan</button></p>
    </>
  );
}
