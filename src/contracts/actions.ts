// FROZEN CONTRACT (Day 0). Each owner adds kinds in its own union below.
export type ActionStatus = "proposed" | "edited" | "approved" | "executed" | "rejected" | "failed";
export type ActionKindA =
  | "send_email" | "send_whatsapp" | "send_clarification" | "send_rfq_batch"
  | "send_reminder" | "new_item_codes" | "erp_import_sheet";
export type ActionKindB = "notify_hod" | "performance_record";
export type ActionKind = ActionKindA | ActionKindB;

export interface ActionRow {
  id: string; case_id: string | null; kind: ActionKind; status: ActionStatus;
  payload: Record<string, unknown>; original_payload: Record<string, unknown> | null;
  proposed_by: string | null; approved_by: string | null; approved_at: string | null;
  reject_reason: string | null; error: string | null;
}
export interface HandlerResult { provider_id?: string; result?: Record<string, unknown> }
export type Handler = (action: ActionRow) => Promise<HandlerResult>;
export type Role = "contracts_engineer" | "hod" | "site_engineer" | "management" | "admin";
