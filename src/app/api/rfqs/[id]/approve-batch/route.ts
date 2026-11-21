import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { approveRfqBatch } from "@/tender/batch";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await approveRfqBatch(id, user.id)) }); } // each mail is checked by the executor
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
