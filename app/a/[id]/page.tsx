import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssignment } from "@/lib/canvas";
import { getProgress } from "@/lib/store";
import { countdown, formatDue } from "@/lib/format";
import Editor from "./Editor";

export const dynamic = "force-dynamic";

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, progress] = await Promise.all([getAssignment(id), getProgress(id)]);
  if (!a) notFound();
  const c = countdown(a.dueAt);
  const done = a.submitted || progress.status === "done";

  return (
    <div className="detail">
      <p className="small"><Link href="/">← All assignments</Link></p>
      <header style={{ marginBottom: 16 }}>
        <span className="chip">{a.courseCode}</span>
        <h1 style={{ fontSize: 24, margin: "6px 0 4px" }}>{a.name}</h1>
        <div className="muted small">
          {a.points != null && `${a.points} pts`}
          {a.submitted && " · Submitted on Quercus"}
          {a.url !== "#" && <> · <a href={a.url} target="_blank" rel="noreferrer">Open in Quercus</a></>}
        </div>
      </header>
      <div className={`next-up ${done ? "is-done" : `u-${c.urgency}`}`} style={{ opacity: 1 }}>
        <span className="muted small">Deadline</span>
        <span className="countdown" style={{ color: "var(--tone)" }}>
          {done ? <span className="cd-label">{a.submitted ? "Submitted" : "Done"}</span> : <>
            <span className="cd-value">{c.value}</span>
            <span className="cd-label">{c.label}</span>
          </>}
        </span>
        <span className="next-when">{formatDue(a.dueAt)}</span>
      </div>
      <Editor id={id} initial={progress} quercusGroup={a.isGroup} />
    </div>
  );
}
