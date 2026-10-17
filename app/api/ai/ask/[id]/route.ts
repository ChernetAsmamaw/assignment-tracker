import { NextResponse } from "next/server";
import { getAssignment } from "@/lib/canvas";
import { getProgress } from "@/lib/store";
import { ask } from "@/lib/ai";

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  if (!question?.trim()) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  const [a, p] = await Promise.all([getAssignment(id), getProgress(id)]);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ answer: await ask(a, p, question.trim().slice(0, 1000)) });
  } catch (e) {
    console.error("ask", e);
    return NextResponse.json({ error: "Gemini couldn't answer right now. Try again." }, { status: 502 });
  }
}
