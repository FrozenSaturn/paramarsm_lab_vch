import { inngest } from "@/workflows/client";
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import type { EventMap } from "@/contracts/events";
import { liveQuoteRows } from "@/compare/load";
import { runComparative, W6 } from "@/compare/run";
import { decideOnDueDate, decideOnQuote, type TriggerDecision } from "@/compare/triggers";

/** Vendors the RFQ went to (sent_at set). The RFQ is the quote's, else the case's newest sent RFQ. */
async function invitedVendors(caseId: string, rfqId: string | null): Promise<string[]> {
  const db = admin();
  let id = rfqId;
  if (!id) {
    const { data: rfqs } = await db.from("rfqs").select("id").eq("case_id", caseId).order("created_at", { ascending: false });
    id = rfqs?.[0]?.id ?? null;
  }
  if (!id) return [];
  const { data } = await db.from("rfq_recipients").select("vendor_id").eq("rfq_id", id).not("sent_at", "is", null);
  return [...new Set((data ?? []).map((r: any) => r.vendor_id as string))];
}

/** Decides whether this event starts a comparative. Reads only. */
async function decide(name: string, data: any): Promise<TriggerDecision> {
  const db = admin();
  const live = await liveQuoteRows(data.case_id);
  if (name === "rfq.due_date_passed") return decideOnDueDate(live.length);
  const e = data as EventMap["quote.extracted"];
  const { data: q } = await db.from("quotes").select("rfq_id,version").eq("id", e.quote_id).maybeSingle();
  const { count } = await db.from("comparatives").select("id", { count: "exact", head: true }).eq("case_id", e.case_id);
  return decideOnQuote({
    invitedVendorIds: await invitedVendors(e.case_id, q?.rfq_id ?? null),
    liveVendorIds: live.map((x) => x.vendor_id),
    quoteVersion: q?.version ?? 1,
    hasComparative: (count ?? 0) > 0,
  });
}

/**
 * W6 Comparative: builds a new comparative version when all invited vendors have quoted,
 * when a revised quote arrives, or when the due date passes with three or more quotes.
 * Fewer than three at the due date raises an alert. One case at a time, so two quotes
 * landing together cannot race on the version number.
 */
export const w6Comparative = inngest.createFunction(
  {
    id: "w6-comparative",
    name: "W6 Comparative",
    triggers: [{ event: "quote.extracted" }, { event: "rfq.due_date_passed" }],
    concurrency: { key: "event.data.case_id", limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const caseId = (event.data as { case_id: string }).case_id;
    const d = await step.run("decide", () => decide(event.name, event.data));
    if (!d.run) {
      await step.run("log wait", () =>
        logStep({
          caseId, workflow: W6, step: d.alert ? "Fewer than three quotes at the due date" : d.waitingFor ? `Waiting for ${d.waitingFor} more quote${d.waitingFor === 1 ? "" : "s"}` : "Not started",
          input: { event: event.name, data: event.data }, reasoning: d.reason, status: d.alert ? "alert" : "waiting",
        }),
      );
      return { ran: false, reason: d.reason };
    }
    const out = await step.run("build comparative", async () => {
      const r = await runComparative({ caseId, trigger: d.trigger, actor: W6 });
      return { comparative_id: r.comparativeId, version: r.version, inputs_hash: r.inputsHash };
    });
    return { ran: true, trigger: d.trigger, ...out };
  },
);
