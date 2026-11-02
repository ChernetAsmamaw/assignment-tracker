import { getAssignments } from "./canvas";
import { getAllProgress, getSettings, listAll, type Settings } from "./store";
import { buildPlan } from "./planner";
import { emptyProgress, type Assignment, type Mastery, type Progress } from "./types";

// Courses and assignments unticked in Settings drop out of every list, plan and email.
export const isIncluded = (a: Assignment, s: Settings) =>
  !s.excludedCourses.includes(a.courseCode) && !s.excludedAssignments.includes(a.id);

export async function getIncludedAssignments(): Promise<Assignment[]> {
  const [assignments, settings] = await Promise.all([getAssignments(), getSettings()]);
  return assignments.filter((a) => isIncluded(a, settings));
}

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [all, saved, settings, mastery] = await Promise.all([
    getAssignments(),
    getAllProgress(),
    getSettings(),
    listAll<Mastery>("mastery"),
  ]);
  const assignments = all.filter((a) => isIncluded(a, settings));
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const plan = buildPlan(assignments, progress, settings);
  return { assignments, progress, settings, plan, mastery: Object.values(mastery).filter((m) => !settings.excludedCourses.includes(m.courseCode)) };
}
