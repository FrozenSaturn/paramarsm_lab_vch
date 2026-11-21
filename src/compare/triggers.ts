/**
 * When W6 builds a comparative on its own (PLAN.md section 7.3). Plain code, so the rules
 * are tested without a database. The "Compare now" button and the script do not ask.
 */
import { MIN_QUOTES } from "./types";

export type CompareTrigger = "button" | "all_quoted" | "due_date" | "revised_quote" | "script";

export type TriggerDecision =
  | { run: true; trigger: CompareTrigger; reason: string }
  | { run: false; reason: string; waitingFor: number; alert?: boolean };

/**
 * After a quote is read. A revised quote (version 2 or more) re-runs a comparative that
 * exists. Otherwise W6 runs when every vendor the RFQ went to has a live quote.
 */
export function decideOnQuote(a: { invitedVendorIds: string[]; liveVendorIds: string[]; quoteVersion: number; hasComparative: boolean }): TriggerDecision {
  if (a.quoteVersion > 1 && a.hasComparative) {
    return { run: true, trigger: "revised_quote", reason: `A revised quote (version ${a.quoteVersion}) arrived after a comparative was built.` };
  }
  const live = new Set(a.liveVendorIds);
  const invited = [...new Set(a.invitedVendorIds)];
  const waiting = invited.filter((v) => !live.has(v)).length;
  if (invited.length > 0 && waiting === 0) {
    return { run: true, trigger: "all_quoted", reason: `All ${invited.length} invited vendors have quoted.` };
  }
  if (invited.length === 0) return { run: false, waitingFor: 0, reason: "The RFQ has no sent recipients, so W6 cannot tell when all vendors have quoted. Use Compare now." };
  return { run: false, waitingFor: waiting, reason: `Waiting for ${waiting} more quote${waiting === 1 ? "" : "s"} (${invited.length - waiting} of ${invited.length} in).` };
}

/** On the RFQ due date: compare with MIN_QUOTES or more live quotes, else raise an alert. */
export function decideOnDueDate(liveQuotes: number): TriggerDecision {
  if (liveQuotes >= MIN_QUOTES) return { run: true, trigger: "due_date", reason: `The due date passed with ${liveQuotes} quotes.` };
  return { run: false, alert: true, waitingFor: MIN_QUOTES - liveQuotes, reason: `Fewer than ${MIN_QUOTES} quotes at the due date (${liveQuotes}). The SOP needs ${MIN_QUOTES}: invite more vendors or extend the date.` };
}
