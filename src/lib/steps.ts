import { admin } from "./supabase";
import type { EventMap, EventName } from "../contracts/events";
import { inngest } from "../workflows/client";

export async function emit<N extends EventName>(name: N, payload: EventMap[N], opts: { caseId?: string; actor?: string } = {}) {
  const { error } = await admin().from("events").insert({ name, payload, case_id: opts.caseId ?? (payload as any).case_id ?? null, actor: opts.actor ?? "system" });
  if (error) throw error;
  // With EMIT_DISPATCHES_TO_INNGEST=true, emit also starts the workflows that listen for this event.
  // B's publish() skips its own send when the flag is true, so no event runs twice.
  if (process.env.EMIT_DISPATCHES_TO_INNGEST === "true") {
    try { await inngest.send({ name, data: payload }); }
    catch (e) {
      if (process.env.NODE_ENV === "production") throw e;
      console.warn(`[emit] ${name} recorded but not dispatched (is the Inngest dev server running?):`, (e as Error).message);
    }
  }
}

export async function logStep(s: { caseId?: string; workflow: string; step: string; input?: unknown; output?: unknown; model?: string; evidence?: unknown; reasoning?: string; status?: string }) {
  const { data, error } = await admin().from("agent_steps").insert({
    case_id: s.caseId ?? null, workflow: s.workflow, step: s.step, input: s.input, output: s.output,
    model: s.model, evidence: s.evidence, reasoning: s.reasoning, status: s.status ?? "done", finished_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
