import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssignment } from "@/lib/canvas";
import { getProgress } from "@/lib/store";
import { countdown, formatDue } from "@/lib/format";
import { hasGemini } from "@/lib/gemini";
import Editor from "./Editor";

export const dynamic = "force-dynamic";

const SUBMISSION_LABEL: Record<string, string> = {
  online_upload: "File upload",
  online_text_entry: "Text entry",
  online_url: "Website URL",
  online_quiz: "Quiz",
  discussion_topic: "Discussion post",
  media_recording: "Media recording",
  on_paper: "On paper",
  external_tool: "External tool",
  none: "No submission",
};

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, progress] = await Promise.all([getAssignment(id), getProgress(id)]);
  if (!a) notFound();
  const c = countdown(a.dueAt);
  const done = a.submitted || progress.status === "done";
  // Submitted on Quercus counts as done, even if it was never marked here.
  const initial = a.submitted && progress.status !== "done" ? { ...progress, status: "done" as const, percent: 100 } : progress;
  const details: [string, string][] = [
    ["Points", a.points != null ? String(a.points) : ""],
    ["Submit as", a.submissionTypes.map((t) => SUBMISSION_LABEL[t] ?? t.replace(/_/g, " ")).join(", ")],
    ["Attempts", a.allowedAttempts ? String(a.allowedAttempts) : ""],
    ["Available from", a.unlockAt ? formatDue(a.unlockAt) : ""],
    ["Closes", a.lockAt ? formatDue(a.lockAt) : ""],
    ["Graded as", a.gradingType ? a.gradingType.replace(/_/g, " ") : ""],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="detail">
      <p className="small"><Link href="/assignments">← All assignments</Link></p>
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
      <details className="card about" open={!done}>
        <summary><h2>Description and details</h2></summary>
        {details.length > 0 && (
          <dl className="facts">
            {details.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {a.description ? (
          <div className="description" dangerouslySetInnerHTML={{ __html: a.description }} />
        ) : (
          <p className="muted small">No description on Quercus.</p>
        )}
      </details>
      <Editor id={id} initial={initial} quercusGroup={a.isGroup} gemini={hasGemini()} />
    </div>
  );
}
