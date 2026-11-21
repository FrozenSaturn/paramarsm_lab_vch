/**
 * Records the HOD's decision (server only). The server action in decide.ts gets the user
 * with requireRole("hod") and calls recordDecisionAs. The role is checked here again, and
 * the database trigger checks it a third time.
 *
 * No agent code path calls this: vendor selection is not an action kind.
 */
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import { publish } from "@/workflows/b/publish";
import type { Role } from "@/contracts/actions";
import type { Matrix } from "./types";
import { decisionDbMessage, validateDecision, type DecisionInput, type DecisionKind } from "./decide-rules";

export const W7 = "W7 approval";

export interface DecisionResult {
  decisionId: string;
  caseId: string;
  kind: DecisionKind;
  vendorId: string | null;
  overridden: boolean;
  status: "decided" | "sent_back";
}

export class DecisionError extends Error {}

export async function recordDecisionAs(user: { id: string; role: Role }, input: DecisionInput): Promise<DecisionResult> {
  if (user.role !== "hod") throw new DecisionError("Only a HOD can record a decision.");
  if (!input.recommendationId) throw new DecisionError("recommendationId is missing.");
  const db = admin();

  const { data: rec, error } = await db.from("recommendations")
    .select("id,case_id,comparative_id,status,top_vendor_id,ranking").eq("id", input.recommendationId).maybeSingle();
  if (error) throw error;
  if (!rec) throw new DecisionError("Recommendation not found.");
  const { data: cmp, error: cErr } = await db.from("comparatives").select("matrix").eq("id", rec.comparative_id).maybeSingle();
  if (cErr) throw cErr;
  const vendors = ((cmp?.matrix as Matrix | undefined)?.vendors ?? []);
  const vendorIds = vendors.map((v) => v.vendor_id);

  const check = validateDecision(input, { status: rec.status, topVendorId: rec.top_vendor_id ?? null, vendorIds });
  if (!check.ok) throw new DecisionError(check.error);
  const row = check.row;
  const caseId = rec.case_id as string;

  // The unique index allows one decision per recommendation, so a double click saves one row.
  const { data: dec, error: dErr } = await db.from("decisions").insert({
    recommendation_id: rec.id, case_id: caseId, kind: row.kind, vendor_id: row.vendor_id, decided_by: user.id,
    overridden: row.overridden, reason: row.reason, top_vendor_id: rec.top_vendor_id, weights: row.weights,
  }).select("id").single();
  if (dErr) throw new DecisionError(decisionDbMessage(dErr));
  const decisionId = dec.id as string;

  const status = row.kind === "send_back" ? "sent_back" : "decided";
  const { error: uErr } = await db.from("recommendations").update({ status }).eq("id", rec.id).eq("status", "with_hod");
  if (uErr) throw uErr;

  const name = (id: string | null) => (id ? vendors.find((v) => v.vendor_id === id)?.name ?? id : "—");
  await logStep({
    caseId, workflow: W7,
    step: row.kind === "approve" ? "HOD approved the top vendor" : row.kind === "override" ? "HOD chose another vendor" : "HOD sent the packet back",
    input: { recommendation_id: rec.id, decided_by: user.id, kind: row.kind, vendor_id: row.vendor_id, weights: row.weights },
    output: { decision_id: decisionId, status, top_vendor_id: rec.top_vendor_id, overridden: row.overridden },
    evidence: { recommendation_id: rec.id, comparative_id: rec.comparative_id },
    reasoning: row.kind === "approve"
      ? `Approved ${name(row.vendor_id)}, the top vendor.${row.reason ? ` Note: ${row.reason}` : ""}`
      : row.kind === "override"
        ? `Chose ${name(row.vendor_id)} instead of the top vendor ${name(rec.top_vendor_id)}. Reason: ${row.reason}`
        : `Sent back. Reason: ${row.reason}`,
  });

  // decision.made needs a vendor_id (frozen contract), so a send-back emits no event.
  // The decisions row and the agent step above are its record; W7 checks the status on timeout.
  if (row.kind !== "send_back" && row.vendor_id) {
    await publish("decision.made", { decision_id: decisionId, case_id: caseId, vendor_id: row.vendor_id, overridden: row.overridden }, { caseId, actor: user.id });
  }

  return { decisionId, caseId, kind: row.kind, vendorId: row.vendor_id, overridden: row.overridden, status };
}
