import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";

/** Short-lived download link for a generated import sheet. */
export async function GET(_req: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { actionId } = await params;
  const db = admin();
  const { data: rec } = await db.from("receipts").select("result, actions!inner(kind)").eq("action_id", actionId).maybeSingle();
  const path = (rec?.result as any)?.path as string | undefined;
  if (!rec || (rec as any).actions.kind !== "erp_import_sheet" || !path) return NextResponse.json({ error: "no sheet" }, { status: 404 });
  const { data } = await db.storage.from(process.env.STORAGE_BUCKET || "documents").createSignedUrl(path, 60);
  if (!data) return NextResponse.json({ error: "could not sign" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
