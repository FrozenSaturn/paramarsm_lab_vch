import { admin } from "../lib/supabase";
import { emit } from "../lib/steps";
import { approveAction } from "../executor";
import "../executor/register";

/** One click for the whole batch. Each mail is still its own action, with its own role check and receipt. */
export async function approveRfqBatch(rfqId: string, userId: string) {
  const db = admin();
  // The executor checks the role again for each mail. This check stops the call early and keeps read-only roles out of the batch.
  const { data: p } = await db.from("profiles").select("role").eq("id", userId).single();
  if (!p || !["contracts_engineer", "admin"].includes(p.role)) throw new Error("forbidden: role cannot send RFQs");
  const { data: rfq } = await db.from("rfqs").select("id, case_id, ref").eq("id", rfqId).single();
  if (!rfq) throw new Error("RFQ not found");
  const { data: recipients } = await db.from("rfq_recipients").select("id, vendor_id, status, vendors!inner(name)").eq("rfq_id", rfqId);
  const { data: acts } = await db.from("actions").select("id, status, original_payload").eq("case_id", rfq.case_id).eq("kind", "send_email").in("status", ["proposed", "edited"]);
  const sent: string[] = [], failed: { vendor: string; error: string }[] = [];
  for (const r of recipients ?? []) {
    if (r.status === "sent") continue;
    const a = (acts ?? []).find(x => (x.original_payload as any)?.rfq_recipient_id === r.id);
    const name = (r as any).vendors.name as string;
    if (!a) { failed.push({ vendor: name, error: "no draft is waiting" }); continue; }
    try { await approveAction(a.id, userId); sent.push(name); } catch (e: any) { failed.push({ vendor: name, error: String(e?.message ?? e) }); }
  }
  const { data: after } = await db.from("rfq_recipients").select("status").eq("rfq_id", rfqId);
  if ((after ?? []).length && (after ?? []).every(r => r.status === "sent")) {
    // Emit only when this call moved the RFQ from draft to sent. A repeat call must not start W4 again.
    const { data: moved } = await db.from("rfqs").update({ status: "sent" }).eq("id", rfqId).neq("status", "sent").select("id");
    if (moved?.length) await emit("rfq.approved", { case_id: rfq.case_id, rfq_id: rfqId }, { caseId: rfq.case_id, actor: userId });
  }
  return { sent, failed };
}
