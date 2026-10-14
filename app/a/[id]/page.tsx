import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssignment } from "@/lib/canvas";
import { getProgress } from "@/lib/store";
import { formatDue, relativeDue } from "@/lib/format";
import Editor from "./Editor";

export const dynamic = "force-dynamic";

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, progress] = await Promise.all([getAssignment(id), getProgress(id)]);
  if (!a) notFound();

  return (
    <>
      <p className="small"><Link href="/">← All assignments</Link></p>
      <header style={{ marginBottom: 20 }}>
        <span className="chip">{a.courseCode}</span>
        <h1 style={{ fontSize: 22, margin: "6px 0 4px" }}>{a.name}</h1>
        <div className="muted small">
          Due {formatDue(a.dueAt)} {a.dueAt && `(${relativeDue(a.dueAt)})`}
          {a.points != null && ` · ${a.points} pts`}
          {a.submitted && " · Submitted on Quercus"}
          {a.url !== "#" && <> · <a href={a.url} target="_blank" rel="noreferrer">Open in Quercus</a></>}
        </div>
      </header>
      <Editor id={id} initial={progress} />
    </>
  );
}
