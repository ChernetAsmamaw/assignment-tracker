import { NextResponse } from "next/server";
import { getProfile, saveProfile } from "@/lib/careers-store";
import type { CareerProfile } from "@/lib/careers";

const TEXT = ["name", "school", "program", "year", "location", "regions", "roles", "skills", "interests", "workAuth", "experience"] as const;

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<CareerProfile>;
  const p = await getProfile();
  for (const k of TEXT) if (typeof b[k] === "string") p[k] = (b[k] as string).slice(0, k === "experience" ? 12000 : 600);
  if (typeof b.conferences === "boolean") p.conferences = b.conferences;
  if (Array.isArray(b.companies)) {
    p.companies = b.companies
      .map((c) => ({ name: String(c.name ?? "").trim().slice(0, 80), url: String(c.url ?? "").trim().slice(0, 300) }))
      .filter((c) => c.name)
      .slice(0, 12);
  }
  await saveProfile(p);
  return NextResponse.json(p);
}
