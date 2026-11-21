/**
 * Risk flags (PLAN.md section 7.4). They sit beside the score and never change it.
 * Plain code; the order of flags for a vendor follows RISK_ORDER.
 */
import type { CompareInput, Matrix } from "@/compare/types";
import { fmtDate, fmtINR } from "@/quotes/format";
import { round } from "@/quotes/units";
import type { RiskCode, RiskFlag, VendorFacts } from "./types";

/** A bid below this share of the median landed_for_price is flagged. */
export const FAR_BELOW_MEDIAN_RATIO = 0.8;

export const RISK_ORDER: RiskCode[] = [
  "unconfirmed_handwriting", "stale", "different_scope", "far_below_median", "lines_missing", "validity_lapsed", "fewer_than_three",
];

/** Median of a list of numbers (mean of the two middle values for an even count). Null for an empty list. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Risk flags keyed by vendor_id, for every vendor in the matrix (an empty list when none apply). */
export function riskFlags(matrix: Matrix, input: CompareInput, facts: VendorFacts[]): Record<string, RiskFlag[]> {
  const factsById = new Map(facts.map((f) => [f.vendor_id, f]));
  const quoteById = new Map(input.quotes.map((q) => [q.quote_id, q]));
  const med = median(Object.values(matrix.totals).map((t) => t.landed_for_price));
  const out: Record<string, RiskFlag[]> = {};

  for (const v of matrix.vendors) {
    const f = factsById.get(v.vendor_id);
    const q = quoteById.get(v.quote_id);
    const t = matrix.totals[v.vendor_id];
    const flags: Partial<Record<RiskCode, RiskFlag>> = {};

    const unconfirmed = (q?.lines ?? []).filter((l) => l.rate_handwritten && !l.rate_confirmed);
    if (unconfirmed.length) {
      flags.unconfirmed_handwriting = {
        code: "unconfirmed_handwriting", severity: "block",
        message: `${unconfirmed.length} handwritten rate${unconfirmed.length === 1 ? " is" : "s are"} not confirmed by a person. Confirm them in the review screen.`,
      };
    }
    if (f?.stale) {
      const qd = v.quote_date ?? q?.quote_date ?? null;
      flags.stale = {
        code: "stale", severity: "warn",
        message: `Quote dated ${fmtDate(qd)}, before the RFQ went out on ${fmtDate(input.rfq_sent_at)}. It was not priced for this RFQ.`,
      };
    }
    if (v.scope === "different") {
      flags.different_scope = { code: "different_scope", severity: "warn", message: "The quote prices a different scope from the BOQ." };
    }
    if (t && med != null && med > 0 && t.landed_for_price < FAR_BELOW_MEDIAN_RATIO * med) {
      const pct = round((100 * t.landed_for_price) / med, 1);
      flags.far_below_median = {
        code: "far_below_median", severity: "warn",
        message: `${fmtINR(t.landed_for_price)} is ${pct}% of the median ${fmtINR(round(med))}. Check the scope and the rates.`,
      };
    }
    if (t && t.lines_missing.length) {
      flags.lines_missing = {
        code: "lines_missing", severity: "warn",
        message: `BOQ line${t.lines_missing.length === 1 ? "" : "s"} ${t.lines_missing.join(", ")} not quoted or not comparable. Loaded at the highest other price for comparison.`,
      };
    }
    if (f?.validity_days_left != null && f.validity_days_left < 0) {
      flags.validity_lapsed = {
        code: "validity_lapsed", severity: "warn",
        message: `Validity lapsed ${-f.validity_days_left} day${f.validity_days_left === -1 ? "" : "s"} before the comparison date. Ask the vendor to extend it.`,
      };
    }
    if (matrix.ranking_withheld) {
      flags.fewer_than_three = {
        code: "fewer_than_three", severity: "warn",
        message: `Only ${matrix.vendors.length} quote${matrix.vendors.length === 1 ? "" : "s"}. The SOP needs three before a ranking.`,
      };
    }
    out[v.vendor_id] = RISK_ORDER.flatMap((c) => (flags[c] ? [flags[c]!] : []));
  }
  return out;
}
