import { getOne, listAll, putOne } from "./store";
import { dedupeKey, DEFAULT_PROFILE, emptyOpportunity, type CareerProfile, type Opportunity } from "./careers";
import { heuristicRelevance } from "./agents/apply";
import { SEED_ROLES } from "./careers-seed";

const OPPS = "opportunities";

export async function listOpportunities(): Promise<Opportunity[]> {
  return Object.values(await listAll<Opportunity>(OPPS));
}

export const getOpportunity = (id: string) => getOne<Opportunity>(OPPS, id);

export async function saveOpportunity(o: Opportunity): Promise<Opportunity> {
  const value = { ...o, updatedAt: new Date().toISOString() };
  await putOne(OPPS, o.id, value);
  return value;
}

export const deleteOpportunity = (id: string) => putOne(OPPS, id, null);

export async function getProfile(): Promise<CareerProfile> {
  return { ...DEFAULT_PROFILE, ...((await getOne<CareerProfile>("career", "profile")) ?? {}) };
}

export const saveProfile = (p: CareerProfile) => putOne("career", "profile", p);

// Add any built-in roles (lib/careers-seed.ts) that haven't been added before.
// A role you delete later stays deleted, because the ids that were added are remembered.
export async function addSeedRoles(): Promise<void> {
  const done = (await getOne<string[]>("career", "seeded")) ?? [];
  const todo = SEED_ROLES.filter((r) => !done.includes(r.id));
  if (!todo.length) return;
  const [existing, profile] = await Promise.all([listOpportunities(), getProfile()]);
  const taken = new Set(existing.flatMap(dedupeKey));
  for (const r of todo) {
    if (existing.some((o) => o.id === r.id) || dedupeKey(r).some((k) => taken.has(k))) continue;
    const now = new Date().toISOString();
    const base = { ...emptyOpportunity(), ...r, whyRelevant: "", createdAt: now, updatedAt: now };
    await saveOpportunity({ ...base, relevance: heuristicRelevance(base, profile) });
  }
  await putOne("career", "seeded", [...done, ...todo.map((r) => r.id)]);
}
