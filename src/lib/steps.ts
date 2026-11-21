import { admin } from "./supabase";
import type { EventMap, EventName } from "../contracts/events";

export async function emit<N extends EventName>(name: N, payload: EventMap[N], opts: { caseId?: string; actor?: string } = {}) {
  const { error } = await admin().from("events").insert({ name, payload, case_id: opts.caseId ?? (payload as any).case_id ?? null, actor: opts.actor ?? "system" });
  if (error) throw error;
  // Inngest dispatch is added when workflows land (src/workflows/a/index.ts).
}

export async function logStep(s: { caseId?: string; workflow: string; step: string; input?: unknown; output?: unknown; model?: string; evidence?: unknown; reasoning?: string; status?: string }) {
  const { data, error } = await admin().from("agent_steps").insert({
    case_id: s.caseId ?? null, workflow: s.workflow, step: s.step, input: s.input, output: s.output,
    model: s.model, evidence: s.evidence, reasoning: s.reasoning, status: s.status ?? "done", finished_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
