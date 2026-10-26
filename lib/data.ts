import { getAssignments } from "./canvas";
import { getAllProgress, getSettings, listAll } from "./store";
import { buildPlan, dayKey } from "./planner";
import { emptyProgress, type Mastery, type Progress } from "./types";
import { capacityFactor, learnPace, paceFactors, type CheckIn, type FocusSession } from "./wellbeing";

// Everything the planner needs, with saved progress filled out to the current shape.
export async function loadAll() {
  const [assignments, saved, settings, mastery, checkinMap, focusMap] = await Promise.all([
    getAssignments(),
    getAllProgress(),
    getSettings(),
    listAll<Mastery>("mastery"),
    listAll<CheckIn>("checkins"),
    listAll<FocusSession>("focus"),
  ]);
  const progress: Record<string, Progress> = {};
  for (const a of assignments) progress[a.id] = { ...emptyProgress(), ...saved[a.id] };
  const today = dayKey(new Date());
  const checkins = Object.values(checkinMap).sort((a, b) => a.date.localeCompare(b.date));
  const sessions = Object.values(focusMap);
  const checkin = checkinMap[today] ?? null;
  const pace = learnPace(sessions);
  const plan = buildPlan(assignments, progress, settings, {}, { pace: paceFactors(pace), today: capacityFactor(checkin) });
  return { assignments, progress, settings, plan, mastery: Object.values(mastery), today, checkin, checkins, sessions, pace };
}
