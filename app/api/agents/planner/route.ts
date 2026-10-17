import { NextResponse } from "next/server";
import { applyInstruction } from "@/lib/agents/planner";
import { getSettings, saveSettings } from "@/lib/store";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { instruction } = (await req.json().catch(() => ({}))) as { instruction?: string };
  if (!instruction?.trim()) return NextResponse.json({ error: "Tell me what's changing" }, { status: 400 });
  const result = await applyInstruction(instruction.trim(), await getSettings());
  await saveSettings(result.settings);
  return NextResponse.json({ reply: result.reply, changes: result.changes, ai: result.ai });
}
