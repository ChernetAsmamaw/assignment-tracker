import { NextResponse } from "next/server";
import { makePlan } from "@/lib/agents/apply";
import { getOpportunity, getProfile, saveOpportunity } from "@/lib/careers-store";

export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [o, profile] = await Promise.all([getOpportunity(id), getProfile()]);
  if (!o) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = await makePlan(o, profile);
  // Moving to "preparing" once there's a plan keeps the list honest about what's under way.
  return NextResponse.json(await saveOpportunity({ ...o, plan, status: o.status === "saved" ? "preparing" : o.status }));
}
