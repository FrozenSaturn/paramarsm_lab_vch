/**
 * Rules for the HOD's decision on a recommendation. Plain code, no server imports.
 * The database CHECKs and trigger enforce the same rules again (see the
 * b_recommendation_decision_sql migration).
 */
import { validateWeights } from "@/scoring/weights";
import type { Weights } from "@/scoring/types";

export type DecisionKind = "approve" | "override" | "send_back";
export const DECISION_KINDS: DecisionKind[] = ["approve", "override", "send_back"];
export const MIN_REASON = 5;

export interface DecisionInput {
  recommendationId: string;
  kind: DecisionKind;
  vendorId?: string | null;
  reason?: string | null;
  /** Weights on screen when the HOD decided ("what if"), for the record only. */
  weights?: unknown;
}

export interface DecisionContext {
  status: string;
  topVendorId: string | null;
  /** Vendors in the comparative. */
  vendorIds: string[];
}

export interface DecisionRow {
  kind: DecisionKind;
  vendor_id: string | null;
  overridden: boolean;
  reason: string | null;
  weights: Weights | null;
}

export type DecisionCheck = { ok: true; row: DecisionRow } | { ok: false; error: string };

/**
 * Checks a decision against the recommendation. Returns the row to insert or a clear error.
 * - approve: the vendor is the top vendor (a vendorId, if given, must be the top vendor).
 * - override: a vendor in the comparative that is not the top vendor, and a reason of 5 or more characters.
 * - send_back: a reason of 5 or more characters, and no vendor.
 * The recommendation must be with the HOD.
 */
export function validateDecision(input: DecisionInput, ctx: DecisionContext): DecisionCheck {
  if (!DECISION_KINDS.includes(input.kind)) return { ok: false, error: `Unknown decision "${String(input.kind)}". Use approve, override or send_back.` };
  if (ctx.status !== "with_hod") {
    const why: Record<string, string> = {
      draft: "The packet is not with the HOD yet. The contracts engineer must send it first.",
      decided: "This recommendation already has a decision.",
      sent_back: "This recommendation was sent back. Wait for the new packet.",
      superseded: "A newer recommendation replaced this one. Open the newest packet.",
    };
    return { ok: false, error: why[ctx.status] ?? `The recommendation is ${ctx.status}; it cannot take a decision.` };
  }
  const reason = (input.reason ?? "").trim();
  const vendorId = (input.vendorId ?? "").trim() || null;
  let weights: Weights | null = null;
  if (input.weights != null) {
    try { weights = validateWeights(input.weights); }
    catch (e) { return { ok: false, error: `The weights are not valid: ${(e as Error).message}` }; }
  }

  if (input.kind === "approve") {
    if (!ctx.topVendorId) return { ok: false, error: "This recommendation has no top vendor to approve." };
    if (vendorId && vendorId !== ctx.topVendorId) return { ok: false, error: "To choose a vendor other than the top vendor, use override and give a reason." };
    return { ok: true, row: { kind: "approve", vendor_id: ctx.topVendorId, overridden: false, reason: reason || null, weights } };
  }
  if (input.kind === "override") {
    if (!vendorId) return { ok: false, error: "Choose the vendor you select instead of the top vendor." };
    if (!ctx.vendorIds.includes(vendorId)) return { ok: false, error: "That vendor is not in this comparative." };
    if (vendorId === ctx.topVendorId) return { ok: false, error: "That is the top vendor. Use approve instead." };
    if (reason.length < MIN_REASON) return { ok: false, error: `A reason is required to choose a vendor other than the top vendor (at least ${MIN_REASON} characters).` };
    return { ok: true, row: { kind: "override", vendor_id: vendorId, overridden: true, reason, weights } };
  }
  if (vendorId) return { ok: false, error: "A send-back selects no vendor." };
  if (reason.length < MIN_REASON) return { ok: false, error: `A reason is required to send the packet back (at least ${MIN_REASON} characters).` };
  return { ok: true, row: { kind: "send_back", vendor_id: null, overridden: false, reason, weights } };
}

/** Maps a database error from the decisions insert (trigger, CHECK, unique index) to a clear message. */
export function decisionDbMessage(err: { code?: string; message?: string; details?: string } | null | undefined): string {
  const msg = `${err?.message ?? ""} ${err?.details ?? ""}`;
  if (/only a HOD can record a decision/i.test(msg)) return "Only a HOD can record a decision.";
  if (err?.code === "23505" || /decisions_one_per_recommendation/.test(msg)) return "This recommendation already has a decision.";
  if (/decisions_reason_chk/.test(msg)) return `A reason of at least ${MIN_REASON} characters is required for an override or a send-back.`;
  if (/decisions_vendor_chk/.test(msg)) return "A send-back has no vendor, and an approval or override must name one.";
  if (/decisions_override_flag_chk/.test(msg)) return "The override flag does not match the decision kind.";
  if (/decisions_kind_chk/.test(msg)) return "Unknown decision kind. Use approve, override or send_back.";
  if (err?.code === "23514") return "The decision breaks a database rule. Check the vendor and the reason.";
  return `Could not save the decision: ${err?.message ?? "unknown error"}`;
}
