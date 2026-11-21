import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { approveAction } from "@/executor";
import "@/executor/register";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const out = await approveAction(id, user.id, body.payload);
    return NextResponse.json({ ok: true, out });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.message?.startsWith("forbidden") ? 403 : 400 }); }
}
