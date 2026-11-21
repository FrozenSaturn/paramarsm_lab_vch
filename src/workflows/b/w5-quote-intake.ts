import { inngest } from "@/workflows/client";
import type { EventMap } from "@/contracts/events";
import { failQuote, loadContext, readQuote, saveQuote, startQuote } from "@/quotes/intake";
import { publish } from "./publish";

/**
 * W5 Quote intake: on quote.received, read the quote, normalise it in code, flag it,
 * and send low-confidence fields and handwriting to review. One case at a time, so two
 * quotes landing together cannot race on versions.
 */
export const w5QuoteIntake = inngest.createFunction(
  {
    id: "w5-quote-intake",
    name: "W5 Quote intake",
    triggers: [{ event: "quote.received" }],
    concurrency: { key: "event.data.case_id", limit: 1 },
    idempotency: "event.data.document_id + '-' + event.data.vendor_id",
    retries: 2,
  },
  async ({ event, step }) => {
    const input = event.data as EventMap["quote.received"];
    const started = await step.run("start", () => startQuote(input));
    if (started.alreadyDone) return { quote_id: started.quoteId, skipped: true };
    try {
      const ctx = await step.run("load context", () => loadContext(input));
      const read = await step.run("read with model", () => readQuote(input, ctx));
      const saved = await step.run("normalise and save", async () => {
        const { normalised, ...payload } = await saveQuote(input, started.quoteId, ctx, read);
        return { ...payload, flags: normalised.flags.map((f) => f.code) };
      });
      await step.run("emit quote.extracted", () =>
        publish("quote.extracted", { quote_id: saved.quote_id, case_id: saved.case_id, needs_review: saved.needs_review }, { caseId: input.case_id, actor: "W5" }),
      );
      return saved;
    } catch (e) {
      await step.run("mark failed", () => failQuote(input, started.quoteId, e));
      throw e;
    }
  },
);
