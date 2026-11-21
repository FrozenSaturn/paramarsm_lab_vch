import { createHash } from "node:crypto";
import { admin } from "../lib/supabase";
import type { ActionKind, ActionRow, Handler, Role } from "../contracts/actions";

const handlers = new Map<ActionKind, Handler>();
export const registerHandler = (kind: ActionKind, fn: Handler) => handlers.set(kind, fn);

// Which roles may approve which kinds. Human-only decisions (vendor selection, WO) have no kind at all.
const APPROVERS: Record<ActionKind, Role[]> = {
  send_email: ["contracts_engineer", "admin"], send_whatsapp: ["contracts_engineer", "admin"],
  send_clarification: ["contracts_engineer", "admin"], send_rfq_batch: ["contracts_engineer", "admin"],
  send_reminder: ["contracts_engineer", "admin"], new_item_codes: ["contracts_engineer", "hod", "admin"],
  erp_import_sheet: ["contracts_engineer", "hod", "admin"], notify_hod: ["contracts_engineer", "admin"],
  performance_record: ["contracts_engineer", "hod", "admin"],
};

async function assertCanAct(id: string, userId: string) {
  const db = admin();
  const { data: profile } = await db.from("profiles").select("role").eq("id", userId).single();
  const { data: row } = await db.from("actions").select("*").eq("id", id).single();
  if (!row) throw new Error("action not found");
  const action = row as ActionRow;
  if (!profile || !APPROVERS[action.kind]?.includes(profile.role)) throw new Error("forbidden: role cannot act on " + action.kind);
  return action;
}

export async function proposeAction(kind: ActionKind, caseId: string | null, payload: Record<string, unknown>, opts: { proposedBy?: string } = {}) {
  const { data, error } = await admin().from("actions")
    .insert({ kind, case_id: caseId, payload, original_payload: payload, proposed_by: opts.proposedBy ?? "agent" })
    .select("*").single();
  if (error) throw error;
  return data as ActionRow;
}

export async function editAction(id: string, userId: string, payload: Record<string, unknown>) {
  await assertCanAct(id, userId);
  const { error } = await admin().from("actions").update({ payload, status: "edited", edited_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id).in("status", ["proposed", "edited"]);
  if (error) throw error;
}

export async function rejectAction(id: string, userId: string, reason: string) {
  await assertCanAct(id, userId);
  const { error } = await admin().from("actions").update({ status: "rejected", reject_reason: reason, approved_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id).in("status", ["proposed", "edited"]);
  if (error) throw error;
}

/** Re-checks the approver's role from the database (not from the UI), runs the handler, writes the receipt. */
export async function approveAction(id: string, userId: string, edits?: Record<string, unknown>) {
  const db = admin();
  const { data: profile } = await db.from("profiles").select("role").eq("id", userId).single();
  const { data: row, error } = await db.from("actions").select("*").eq("id", id).single();
  if (error || !row) throw new Error("action not found");
  const action = row as ActionRow;
  if (!profile || !APPROVERS[action.kind]?.includes(profile.role)) throw new Error("forbidden: role cannot approve " + action.kind);
  if (!["proposed", "edited"].includes(action.status)) throw new Error(`cannot approve an action that is ${action.status}`);
  const handler = handlers.get(action.kind);
  if (!handler) throw new Error("no handler registered for " + action.kind);

  const payload = edits ?? action.payload;
  const approvedAt = new Date().toISOString();
  // Claim the action atomically so a double click cannot run it twice.
  const { data: claimed } = await db.from("actions")
    .update({ status: "approved", payload, approved_by: userId, approved_at: approvedAt, updated_at: approvedAt })
    .eq("id", id).in("status", ["proposed", "edited"]).select("*").single();
  if (!claimed) throw new Error("action already handled");

  try {
    const res = await handler(claimed as ActionRow);
    await db.from("receipts").insert({
      action_id: id, payload, payload_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      approved_by: userId, approved_at: approvedAt, provider_id: res.provider_id, result: res.result,
    });
    await db.from("actions").update({ status: "executed", updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: true as const, ...res };
  } catch (e: any) {
    await db.from("actions").update({ status: "failed", error: String(e?.message ?? e), updated_at: new Date().toISOString() }).eq("id", id);
    throw e;
  }
}
