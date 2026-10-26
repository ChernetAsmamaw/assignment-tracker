import { NextResponse } from "next/server";
import { getIncludedAssignments } from "@/lib/data";
import type { Lecture } from "@/lib/lectures";
import { getOne, listAll, putOne } from "@/lib/store";
import { conceptKey, courseFromParam, emptyStudy, newConcept, traceConcept, type ConceptStatus, type CourseStudy } from "@/lib/study";

const STATUSES: ConceptStatus[] = ["new", "learning", "understood"];

// Change how well you understand a concept, add one yourself, or remove one.
export async function PUT(req: Request, { params }: { params: Promise<{ course: string }> }) {
  const code = courseFromParam((await params).course);
  const b = (await req.json().catch(() => ({}))) as { status?: Record<string, string>; add?: string; remove?: string };
  const name = String(b.add ?? "").trim().slice(0, 80);

  // A concept you add is traced to the classes that mention it and the work that needs it.
  let traced: ReturnType<typeof traceConcept> | null = null;
  if (name) {
    const [lectures, assignments] = await Promise.all([listAll<Lecture>("lectures"), getIncludedAssignments()]);
    const mine = Object.values(lectures).filter((l) => l.courseCode === code).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    traced = traceConcept(name, mine, assignments.filter((a) => a.courseCode === code && !a.submitted));
  }

  const study = (await getOne<CourseStudy>("study", code)) ?? emptyStudy(code);
  const now = new Date().toISOString();
  const hidden = new Set(study.hidden ?? []);
  for (const [id, status] of Object.entries(b.status ?? {})) {
    const c = study.concepts.find((x) => x.id === id);
    if (c && STATUSES.includes(status as ConceptStatus)) Object.assign(c, { status, updatedAt: now });
  }
  if (traced && !study.concepts.some((c) => conceptKey(c.name) === conceptKey(name))) {
    study.concepts.push({ ...newConcept(name), ...traced });
    hidden.delete(conceptKey(name));
  }
  const gone = study.concepts.find((c) => c.id === b.remove);
  if (gone) {
    study.concepts = study.concepts.filter((c) => c !== gone);
    hidden.add(conceptKey(gone.name)); // so the next rebuild doesn't bring it back
  }
  study.hidden = [...hidden];
  await putOne("study", code, study);
  return NextResponse.json(study);
}
