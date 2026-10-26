import { getOne, listAll, putOne } from "./store";
import { DEFAULT_PROFILE, type CareerProfile, type Opportunity } from "./careers";

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
