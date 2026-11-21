/**
 * The facts each vendor is scored on, from the matrix and the quote fields. Plain code:
 * no model output enters here that a person has not reviewed, and nothing reads the clock.
 */
import type { CompareInput, CompareQuote, Matrix } from "@/compare/types";
import { daysBetween } from "@/quotes/format";
import { parseAdvancePct, parseCompletionDays, parsePaymentDays, parseWarrantyMonths } from "./parse";
import type { PerformanceRecord, VendorFacts } from "./types";

/** Inputs that are not in the matrix: past work orders, reminders sent, and the case's required days. */
export interface FactsExtra {
  /** `vendor_performance` rows keyed by vendor_id. */
  performance: Record<string, PerformanceRecord[]>;
  /** Reminders sent to each vendor for this RFQ, keyed by vendor_id. */
  reminders: Record<string, number>;
  /** Days the case allows for the work. Null when the case has no required date. */
  required_days: number | null;
}

/** The comparison's "as of" date: the matrix value, else the RFQ due date, else the RFQ send date. */
export const asOfDate = (matrix: Matrix, input: CompareInput) => matrix.as_of ?? input.rfq_due_date ?? input.rfq_sent_at ?? null;

/** True when the quote is dated before the day the RFQ went out. */
export function isStale(quoteDate: string | null, rfqSentAt: string | null): boolean {
  if (!quoteDate || !rfqSentAt) return false;
  return quoteDate.slice(0, 10) < rfqSentAt.slice(0, 10);
}

/**
 * Days of validity left on the "as of" date: valid_until − as_of, else validity_days −
 * days from the quote date (or the arrival date) to as_of. Negative means lapsed.
 * Null when the quote states no validity or there is no "as of" date.
 */
export function validityDaysLeft(q: Pick<CompareQuote, "valid_until" | "validity_days" | "quote_date" | "received_at">, asOf: string | null): number | null {
  if (!asOf) return null;
  if (q.valid_until) return daysBetween(asOf, q.valid_until);
  const start = q.quote_date ?? q.received_at;
  if (q.validity_days != null && start) return q.validity_days - daysBetween(start, asOf);
  return null;
}

/**
 * One VendorFacts per vendor in the matrix, in the matrix's vendor order.
 * Throws when the matrix names a quote that is not in the input.
 */
export function vendorFacts(matrix: Matrix, input: CompareInput, extra: FactsExtra): VendorFacts[] {
  const asOf = asOfDate(matrix, input);
  const all = Object.values(matrix.totals).map((t) => t.landed_for_price);
  const lowest = matrix.lowest_landed_vendor_id
    ? matrix.totals[matrix.lowest_landed_vendor_id]?.landed_for_price ?? Math.min(...all)
    : all.length ? Math.min(...all) : 0;
  const quoteById = new Map(input.quotes.map((q) => [q.quote_id, q]));
  const required = extra.required_days != null && extra.required_days > 0 ? extra.required_days : null;

  return matrix.vendors.map((v) => {
    const q = quoteById.get(v.quote_id);
    if (!q) throw new Error(`Matrix vendor ${v.vendor_id} names quote ${v.quote_id}, which is not in the input.`);
    const t = matrix.totals[v.vendor_id];
    if (!t) throw new Error(`Matrix has no totals for vendor ${v.vendor_id}.`);
    return {
      vendor_id: v.vendor_id,
      landed_for_price: t.landed_for_price,
      lowest_landed_for_price: lowest,
      terms: matrix.terms.map((row) => ({ term: row.term, status: row.cells[v.vendor_id]?.status ?? "not_stated" })),
      boq_lines: matrix.rows.length,
      lines_missing: t.lines_missing.length,
      completion_days: parseCompletionDays(q.completion_time),
      required_days: required,
      rfq_sent_at: input.rfq_sent_at,
      received_at: v.received_at ?? q.received_at,
      stale: isStale(v.quote_date ?? q.quote_date, input.rfq_sent_at),
      reminders_sent: Math.max(0, extra.reminders[v.vendor_id] ?? 0),
      advance_pct: parseAdvancePct(q.advance) ?? parseAdvancePct(q.payment_terms),
      payment_days: parsePaymentDays(q.payment_terms),
      validity_days_left: validityDaysLeft(q, asOf),
      warranty_months: parseWarrantyMonths(q.warranty),
      performance: extra.performance[v.vendor_id] ?? [],
    };
  });
}
