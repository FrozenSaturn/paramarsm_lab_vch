"use server";
/**
 * Server actions for the HOD's decision. Only the HOD role can call them: a contracts
 * engineer, site engineer, management or admin gets "forbidden". The role comes from the
 * database, not from the UI.
 */
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { DecisionError, recordDecisionAs, type DecisionResult } from "./decide-core";
import type { DecisionInput, DecisionKind } from "./decide-rules";

/** Records approve, override or send_back on a recommendation that is with the HOD. */
export async function recordDecision(input: DecisionInput): Promise<DecisionResult> {
  const user = await requireRole("hod");
  const res = await recordDecisionAs(user, input);
  revalidatePath("/approvals");
  revalidatePath(`/cases/${res.caseId}`);
  return res;
}

/** Form version for a client form: returns { ok, error } so the screen can show the message. */
export async function decideFromForm(form: FormData): Promise<{ ok: true; result: DecisionResult } | { ok: false; error: string }> {
  try {
    const weightsRaw = form.get("weights");
    const result = await recordDecision({
      recommendationId: String(form.get("recommendation_id") ?? ""),
      kind: String(form.get("kind") ?? "") as DecisionKind,
      vendorId: (form.get("vendor_id") as string | null) || null,
      reason: (form.get("reason") as string | null) ?? null,
      weights: typeof weightsRaw === "string" && weightsRaw ? JSON.parse(weightsRaw) : null,
    });
    return { ok: true, result };
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof DecisionError) return { ok: false, error: msg };
    if (msg === "forbidden") return { ok: false, error: "Only a HOD can record a decision." };
    return { ok: false, error: msg };
  }
}
