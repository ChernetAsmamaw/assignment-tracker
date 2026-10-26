import { notFound } from "next/navigation";
import { courseColor } from "@/lib/colors";
import { loadAll } from "@/lib/data";
import { hasGemini } from "@/lib/gemini";
import { clock, type Lecture } from "@/lib/lectures";
import { isOpen } from "@/lib/planner";
import { getOne, listAll } from "@/lib/store";
import { courseFromParam, courseTitle, emptyStudy, studyHref, type CourseStudy } from "@/lib/study";
import CourseView, { type ConceptQuote } from "./CourseView";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ course: string }> }) {
  const code = courseFromParam((await params).course);
  const [{ assignments, progress }, all, saved] = await Promise.all([loadAll(), listAll<Lecture>("lectures"), getOne<CourseStudy>("study", code)]);
  const lectures = Object.values(all)
    .filter((l) => l.courseCode === code)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const work = assignments.filter((a) => a.courseCode === code);
  if (!work.length && !lectures.length && !saved) notFound();
  const study = saved ?? emptyStudy(code);

  // The transcript lines behind each concept's explanation, for its hover card.
  const byId = new Map(lectures.map((l) => [l.id, l]));
  const quotes: Record<string, ConceptQuote[]> = {};
  for (const c of study.concepts) {
    quotes[c.id] = c.sources.flatMap((src) => {
      const l = byId.get(src.lectureId);
      if (!l) return [];
      return src.segments.slice(0, 3).flatMap((sid) => {
        const seg = l.segments.find((s) => s.id === sid);
        return seg ? [{ key: `${l.id}:${sid}`, time: clock(seg.start), text: seg.text, label: l.title, href: `${studyHref(code, l.id)}#${sid}` }] : [];
      });
    });
  }

  return (
    <CourseView
      key={code}
      code={code}
      name={courseTitle(code, work[0]?.course ?? "")}
      color={courseColor(code)}
      gemini={hasGemini()}
      initial={study}
      quotes={quotes}
      lectures={lectures.map((l) => ({
        id: l.id,
        title: l.title,
        createdAt: l.createdAt,
        duration: l.duration,
        preview: l.notes?.summary[0]?.text ?? (l.segments.length ? `${l.segments.length} transcript lines, notes not written yet` : "Not recorded yet"),
      }))}
      work={work.map((a) => ({ id: a.id, name: a.name, dueAt: a.dueAt, open: isOpen(a, progress[a.id]) }))}
    />
  );
}
