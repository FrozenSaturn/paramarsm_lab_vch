import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { confirmCode } from "@/codes/pipeline";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const choice = typeof body.itemCodeId === "string" ? { itemCodeId: body.itemCodeId } : body.newCode === true ? { newCode: true as const } : null;
  if (!choice) return NextResponse.json({ error: "send itemCodeId or newCode" }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...(await confirmCode(id, user.id, choice)) }); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message?.startsWith("forbidden") ? 403 : 400 }); }
}
