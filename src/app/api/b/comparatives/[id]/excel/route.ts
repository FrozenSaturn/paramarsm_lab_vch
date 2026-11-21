import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { comparativeWorkbook } from "@/compare/excel";
import { loadComparative } from "@/compare/stored";

export const dynamic = "force-dynamic";

/** The saved comparative as an Excel download. Any signed-in, allow-listed user may read it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const c = await loadComparative(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = admin();
  const [{ data: kase }, { data: rfq }] = await Promise.all([
    db.from("cases").select("title").eq("id", c.case_id).maybeSingle(),
    c.rfq_id ? db.from("rfqs").select("ref").eq("id", c.rfq_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const caseTitle = kase?.title ?? c.case_id;
  const buf = await comparativeWorkbook({
    matrix: c.matrix, scores: c.scores, weights: c.weights,
    meta: { caseTitle, rfqRef: (rfq as any)?.ref ?? null, version: c.version, createdAt: c.created_at },
  });
  const slug = caseTitle.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || c.case_id.slice(0, 8);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CS-${slug}-v${c.version}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
