import { NextResponse } from "next/server";
import { getAssignment } from "@/lib/canvas";
import { suggestResources } from "@/lib/ai";
import { cached } from "@/lib/store";

export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getAssignment(id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await cached(`resources:${id}`, 24 * 3600, () => suggestResources(a)));
}
