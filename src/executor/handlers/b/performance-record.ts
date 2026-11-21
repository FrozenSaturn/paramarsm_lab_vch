/**
 * `performance_record`: a person confirms a rating that an agent proposed from a memory.
 * On approval we write one vendor_performance row. From then on it is a structured fact
 * that scoring can use. The model never writes this row: only an approval does.
 */
import { registerHandler } from "@/executor";
import { admin } from "@/lib/supabase";
import { validatePerformance } from "@/agents/b/performance-payload";

registerHandler("performance_record", async (action) => {
  if (!action.approved_by) throw new Error("performance_record needs an approver: the approver is who confirms the rating.");
  const check = validatePerformance(action.original_payload, action.payload);
  if (!check.ok) throw new Error(`performance_record payload is not valid: ${check.errors.join("; ")}`);
  const db = admin();
  const { data: vendor } = await db.from("vendors").select("id").eq("id", check.row.vendor_id).maybeSingle();
  if (!vendor) throw new Error(`vendor ${check.row.vendor_id} not found`);
  const { data, error } = await db.from("vendor_performance").insert({
    ...check.row,
    case_id: action.case_id,
    confirmed_by: action.approved_by,
    source: "confirmed",
    is_demo: false,
    action_id: action.id,
  }).select("id").single();
  if (error || !data) throw new Error(`vendor_performance insert failed: ${error?.message ?? "no row"}`);
  return { result: { vendor_performance_id: data.id } };
});
