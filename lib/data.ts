import { getAssignments } from "./canvas";
import { getAllProgress, getSettings, listAll } from "./store";
import { buildPlan, isOpen } from "./planner";
import { studyTasks, type CourseStudy } from "./study";
import { emptyProgress, type Mastery, type Progress } from "./types";

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [assignments, saved, settings, study, mastery] = await Promise.all([
    getAssignments(),
    getAllProgress(),
    getSettings(),
    listAll<CourseStudy>("study"),
    listAll<Mastery>("mastery"),
  ]);
  const studies = Object.values(study);
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const plan = buildPlan(assignments, progress, settings, studyTasks(studies, assignments.filter((a) => isOpen(a, progress[a.id]))));
  return { assignments, progress, settings, plan, studies, mastery: Object.values(mastery) };
}
