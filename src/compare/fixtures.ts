/**
 * Test helper: a CompareInput built from the hand-checked fixtures. Each quote goes through
 * normaliseQuote, so the tests use the same numbers that W5 stores. Pure code, no database.
 */
import { normaliseQuote } from "@/quotes/normalise";
import {
  FIXTURE_VENDOR_NAMES, fixtureBoq, fixtureBoqRaw, fixtureExtraction, fixtureFor, fixtureRfqSentAt, fixtureSecondRead,
  type FixtureVendor,
} from "@/quotes/fixture-quotes";
import { gstFraction } from "./matrix";
import type { CompareBoqLine, CompareInput, CompareQuote } from "./types";

export const FIXTURE_VENDORS: FixtureVendor[] = ["bajrang", "purvyakruti", "shyama", "sk"];
export const fixtureVendorId = (v: FixtureVendor) => `vendor-${v}`;
export const FIXTURE_CASE_ID = "case-amara-tower2";
export const FIXTURE_RFQ_ID = "rfq-amara-wp";

/** Made-up arrival times for the tests. The fixtures do not record when each quote came in. */
export const FIXTURE_RECEIVED_AT: Record<FixtureVendor, string> = {
  bajrang: "2026-11-18T11:20:00+05:30",
  purvyakruti: "2026-11-17T16:05:00+05:30",
  shyama: "2026-11-19T12:40:00+05:30",
  sk: "2026-11-20T09:30:00+05:30",
};

export interface FixtureInputOptions {
  /** Vendors to include (default: all four). */
  vendors?: FixtureVendor[];
  /** True: a person confirmed every SK handwritten rate. Default false: SK needs review. */
  skConfirmed?: boolean;
}

/** BOQ lines with stable fake ids, in Vinayak's own units (SQFT and RMT) and quantities. */
export function fixtureCompareBoq(): CompareBoqLine[] {
  return fixtureBoq.map((b) => ({ id: `boq-line-${b.serial}`, serial: b.serial, description: b.description, unit: b.unit, quantity: b.quantity }));
}

export function compareInputFromFixtures(opts: FixtureInputOptions = {}): CompareInput {
  const vendors = opts.vendors ?? FIXTURE_VENDORS;
  const asOf = fixtureBoqRaw.rfq.due_date;
  const quotes: CompareQuote[] = vendors.map((v) => {
    const raw = fixtureFor(v);
    const x = fixtureExtraction(v);
    const confirmed = v === "sk" && opts.skConfirmed ? new Set(raw.lines.map((l) => `line:${l.serial}:rate`)) : undefined;
    const n = normaliseQuote(x, { boq: fixtureBoq, rfqSentAt: fixtureRfqSentAt, asOf, secondRead: v === "sk" ? fixtureSecondRead("sk") : null, confirmed });
    const h = x.header;
    const id = fixtureVendorId(v);
    return {
      quote_id: `quote-${v}`,
      vendor_id: id,
      vendor_name: FIXTURE_VENDOR_NAMES[v],
      version: 1,
      status: n.needs_review ? "needs_review" : "ready",
      document_id: `document-${v}`,
      quote_date: n.quote_date,
      received_at: FIXTURE_RECEIVED_AT[v],
      scope: n.scope,
      gst_treatment: n.gst.treatment,
      gst_rate: gstFraction(n.gst.rate),
      validity_days: n.validity_days,
      valid_until: n.valid_until,
      payment_terms: h.payment_terms.value,
      advance: h.advance.value,
      completion_time: h.completion_time.value,
      mobilisation: h.mobilisation.value,
      warranty: h.warranty.value,
      needs_review: n.needs_review,
      flags: n.flags,
      lines: n.lines.map((l) => ({
        id: `${id}-line-${l.serial}`,
        boq_line_id: null,
        boq_serial: l.boq_serial,
        serial: l.serial,
        item: l.item,
        unit_raw: l.unit_raw,
        quantity: l.quantity,
        rate: l.rate,
        normalized_rate: l.normalized_rate,
        normalized_unit: l.normalized_unit,
        make: l.make,
        page: l.page,
        rate_handwritten: l.rate_handwritten,
        rate_confirmed: !!confirmed?.has(`line:${l.serial}:rate`),
        flags: l.flags,
      })),
      terms: n.terms.map((t) => ({ term: t.term, status: t.status, detail: t.detail?.trim() ? t.detail : null })),
    };
  });
  return {
    case_id: FIXTURE_CASE_ID,
    rfq_id: FIXTURE_RFQ_ID,
    boq_version_id: "boq-version-amara-tender",
    rfq_sent_at: fixtureRfqSentAt,
    rfq_due_date: asOf,
    boq: fixtureCompareBoq(),
    quotes,
  };
}
