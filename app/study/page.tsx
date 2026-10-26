import Link from "next/link";
import { Crumbs } from "@/components/Doc";
import { courseColor } from "@/lib/colors";
import { loadAll } from "@/lib/data";
import { formatDay } from "@/lib/format";
import { clock, type Lecture } from "@/lib/lectures";
import { isOpen } from "@/lib/planner";
import { listAll } from "@/lib/store";
import { CONCEPT_STATUS, courseTitle, focusList, studyHref } from "@/lib/study";
import NewClass from "./NewClass";

export const dynamic = "force-dynamic";

export default async function StudyPage() {
  const [{ assignments, progress, studies, settings }, all] = await Promise.all([loadAll(), listAll<Lecture>("lectures")]);
  const lectures = Object.values(all)
    .filter((l) => !settings.excludedCourses.includes(l.courseCode))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = assignments.filter((a) => isOpen(a, progress[a.id]));
  const codes = [...new Set([...assignments.map((a) => a.courseCode), ...lectures.map((l) => l.courseCode), ...studies.map((s) => s.courseCode)])].filter(Boolean).sort();
  const studyBy = new Map(studies.map((s) => [s.courseCode, s]));
  const focus = focusList(studies, open).slice(0, 8);
  const dueNext = (code: string) =>
    open.filter((a) => a.courseCode === code && a.dueAt && new Date(a.dueAt).getTime() > Date.now()).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0];

  return (
    <article className="doc">
      <div className="doc-top">
        <Crumbs trail={[{ label: "Study" }]} />
        <div className="doc-actions">
          <NewClass courses={codes.map((code) => ({ code, color: courseColor(code) }))} />
        </div>
      </div>

      <div className="doc-icon" aria-hidden>📚</div>
      <h1 className="doc-title">Study</h1>
      <p className="doc-sub">Understand the ideas behind your projects and assignments. Each course keeps its class notes and the concepts its work needs in one place.</p>

      <h2>Courses</h2>
      <div className="g-cards">
        {codes.map((code) => {
          const s = studyBy.get(code);
          const total = s?.concepts.length ?? 0;
          const ok = s?.concepts.filter((c) => c.status === "understood").length ?? 0;
          const classes = lectures.filter((l) => l.courseCode === code).length;
          const next = dueNext(code);
          return (
            <Link key={code} href={studyHref(code)} className="g-card" style={{ ["--c" as string]: courseColor(code) }}>
              <span className="g-cover" aria-hidden />
              <span className="g-body">
                <strong>{code}</strong>
                <span className="g-name">{courseTitle(code, assignments.find((a) => a.courseCode === code)?.course ?? "") || " "}</span>
                <span className="bar" aria-hidden><i style={{ width: `${total ? (ok / total) * 100 : 0}%` }} /></span>
                <span className="g-line">{total ? `${ok} of ${total} concepts understood` : "No concepts yet"}</span>
                <span className="g-line faint">
                  {classes ? `${classes} class${classes === 1 ? "" : "es"} of notes` : "No class notes yet"}
                  {next ? ` · next due ${formatDay(next.dueAt!)}` : ""}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <h2>Understand next</h2>
      {focus.length ? (
        <div className="db-list">
          {focus.map(({ concept, courseCode, assignment }) => (
            <Link key={concept.id} href={`${studyHref(courseCode)}#${concept.id}`} className="db-row">
              <span className={`pill cs-${concept.status}`}>{CONCEPT_STATUS[concept.status]}</span>
              <span className="db-main">
                <span className="db-title">{concept.name}</span>
                <span className="db-preview">{courseCode}{assignment ? ` · for ${assignment.name}` : ""}</span>
              </span>
              <span className="db-meta">{assignment?.dueAt ? `due ${formatDay(assignment.dueAt)}` : ""}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="faint">
          {studies.some((s) => s.concepts.length)
            ? "You've marked every concept as understood. Nice."
            : "Open a course to find the concepts its assignments and projects depend on. They show up here, soonest needed first."}
        </p>
      )}

      {lectures.length > 0 && (
        <>
          <h2>Recent classes</h2>
          <div className="db-list">
            {lectures.slice(0, 6).map((l) => (
              <Link key={l.id} href={studyHref(l.courseCode, l.id)} className="db-row">
                <span className="db-ico" aria-hidden>📄</span>
                <span className="db-main">
                  <span className="db-title">{l.title}</span>
                  <span className="db-preview">{l.notes?.summary[0]?.text ?? (l.segments.length ? "Notes not written yet" : "Not recorded yet")}</span>
                </span>
                <span className="db-meta">{l.courseCode} · {formatDay(l.createdAt)}{l.duration ? ` · ${clock(l.duration)}` : ""}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
