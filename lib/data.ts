import { getAssignments } from "./canvas";
import { getAllProgress, getSettings } from "./store";
import { buildPlan } from "./planner";
import { emptyProgress, type Progress } from "./types";

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [assignments, saved, settings] = await Promise.all([getAssignments(), getAllProgress(), getSettings()]);
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const plan = buildPlan(assignments, progress, settings);
  return { assignments, progress, settings, plan };
}
