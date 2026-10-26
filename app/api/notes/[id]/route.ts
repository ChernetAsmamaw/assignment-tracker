import { NextResponse } from "next/server";
import { putOne } from "@/lib/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id.startsWith("imp_")) return NextResponse.json({ error: "Only pasted notes can be removed here" }, { status: 400 });
  await putOne("coursenotes", id, null);
  return NextResponse.json({ ok: true });
}
