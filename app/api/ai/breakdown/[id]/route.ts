import { NextResponse } from "next/server";
import { getAssignment } from "@/lib/canvas";
import { breakdown } from "@/lib/ai";

export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getAssignment(id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await breakdown(a));
}
