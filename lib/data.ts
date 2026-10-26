import { getAssignments } from "./canvas";
import { getAllProgress, getSettings, listAll } from "./store";
import { buildPlan } from "./planner";
import { emptyProgress, type Mastery, type Progress } from "./types";

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [assignments, saved, settings, mastery] = await Promise.all([
    getAssignments(),
    getAllProgress(),
    getSettings(),
    listAll<Mastery>("mastery"),
  ]);
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const plan = buildPlan(assignments, progress, settings);
  return { assignments, progress, settings, plan, mastery: Object.values(mastery) };
}
