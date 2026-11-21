import { emit } from "@/lib/steps";
import { inngest } from "@/workflows/client";
import type { EventMap, EventName } from "@/contracts/events";

/**
 * Emit one of B's events: A's emit() writes the events row (the audit record), and,
 * until emit() also dispatches to Inngest (issue for-A), we send it to Inngest here.
 * Delete the inngest.send line when A's emit dispatches, or every event runs twice.
 */
export async function publish<N extends EventName>(name: N, payload: EventMap[N], opts: { caseId?: string; actor?: string } = {}) {
  await emit(name, payload, opts);
  if (process.env.EMIT_DISPATCHES_TO_INNGEST === "true") return;
  try {
    await inngest.send({ name, data: payload });
  } catch (e) {
    // In dev, the events row is enough when no Inngest dev server is running.
    if (process.env.NODE_ENV === "production") throw e;
    console.warn(`[publish] ${name} recorded but not dispatched (is the Inngest dev server running?):`, (e as Error).message);
  }
}
