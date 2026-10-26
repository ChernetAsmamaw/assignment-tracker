import { getAssignments } from "./canvas";
import { getAllProgress, getSettings, listAll } from "./store";
import { buildPlan } from "./planner";
import { emptyProgress, type Mastery, type Progress, type StudyPlan } from "./types";

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [assignments, saved, settings, plans, mastery] = await Promise.all([
    getAssignments(),
    getAllProgress(),
    getSettings(),
    listAll<StudyPlan>("studyplans"),
    listAll<Mastery>("mastery"),
  ]);
  const studyPlans = Object.values(plans).sort((a, b) => a.examAt.localeCompare(b.examAt));
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const plan = buildPlan(assignments, progress, settings, studyPlans);
  return { assignments, progress, settings, plan, studyPlans, mastery: Object.values(mastery) };
}
