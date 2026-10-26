import { getAssignments } from "./canvas";
import { getAllProgress, getSettings, listAll, type Settings } from "./store";
import { buildPlan } from "./planner";
import { emptyProgress, type Assignment, type Mastery, type Progress, type StudyPlan } from "./types";

// Courses and assignments unticked on the Courses page drop out of every list, plan and email.
export const isIncluded = (a: Assignment, s: Settings) =>
  !s.excludedCourses.includes(a.courseCode) && !s.excludedAssignments.includes(a.id);

export async function getIncludedAssignments(): Promise<Assignment[]> {
  const [assignments, settings] = await Promise.all([getAssignments(), getSettings()]);
  return assignments.filter((a) => isIncluded(a, settings));
}

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [all, saved, settings, plans, mastery] = await Promise.all([
    getAssignments(),
    getAllProgress(),
    getSettings(),
    listAll<StudyPlan>("studyplans"),
    listAll<Mastery>("mastery"),
  ]);
  const courseOn = (code: string) => !settings.excludedCourses.includes(code);
  const assignments = all.filter((a) => isIncluded(a, settings));
  const studyPlans = Object.values(plans)
    .filter((p) => courseOn(p.courseCode))
    .sort((a, b) => a.examAt.localeCompare(b.examAt));
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const plan = buildPlan(assignments, progress, settings, studyPlans);
  return { assignments, progress, settings, plan, studyPlans, mastery: Object.values(mastery).filter((m) => courseOn(m.courseCode)) };
}
