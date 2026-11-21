/**
 * The four sample quotes as a perfect reader would return them, built from the
 * hand-checked ground truth in fixtures/quotes.json. Used by tests, by the reading
 * eval, and by QUOTE_READER=fixture (dev only: runs the pipeline without a model call).
 */
import quotesJson from "../../fixtures/quotes.json";
import boqJson from "../../fixtures/boq-amara-tower2.json";
import { HEADER_FIELDS, type ExtractedQuote, type HandwrittenRates } from "./schema";
import { TERM_KEYS, type TermStatus } from "./terms";
import type { BoqLineIn } from "./normalise";

export type FixtureVendor = "bajrang" | "purvyakruti" | "shyama" | "sk";
type Q = (typeof quotesJson.quotes)[number];

export const fixtureQuotes = quotesJson.quotes as Q[];
export const fixtureRfqSentAt = quotesJson.rfq_sent_at;
/** The four quoting vendors as A's master seed names them (scripts/seed/a/master.ts); W5 and the dev seed find them by name. */
export const FIXTURE_VENDOR_NAMES: Record<FixtureVendor, string> = {
  bajrang: "Bajrang Construction & Waterproofing",
  purvyakruti: "Purvyakruti",
  shyama: "Shyama",
  sk: "S.K. Construction",
};
export const fixtureBoqRaw = boqJson;
export const fixtureBoq: BoqLineIn[] = boqJson.lines.map((l) => ({ id: null, serial: l.serial, description: l.description, unit: l.unit, quantity: l.quantity }));

export function fixtureFor(vendor: FixtureVendor): Q {
  const q = fixtureQuotes.find((x) => x.vendor_key === vendor);
  if (!q) throw new Error(`no fixture for ${vendor}`);
  return q;
}

/** Find the fixture whose PDF has this file name (for QUOTE_READER=fixture). */
export const fixtureByFilename = (name: string | null | undefined) =>
  fixtureQuotes.find((q) => name && q.file.split("/").pop()?.toLowerCase() === name.split("/").pop()?.toLowerCase()) ?? null;

export function fixtureExtraction(vendor: FixtureVendor | Q): ExtractedQuote {
  const q = typeof vendor === "string" ? fixtureFor(vendor) : vendor;
  const header = Object.fromEntries(
    HEADER_FIELDS.map((f) => {
      const v = (q.header as Record<string, string | null | undefined>)[f] ?? null;
      return [f, { value: v, page: v ? 1 : null, snippet: v, confidence: v ? 0.95 : 0.9 }];
    }),
  ) as ExtractedQuote["header"];
  return {
    header,
    lines: q.lines.map((l) => ({
      serial: l.serial, item: boqJson.lines.find((b) => b.serial === l.boq_serial)?.description ?? "", boq_serial: l.boq_serial,
      unit: l.unit, quantity: l.quantity, rate: l.rate, amount: l.amount, make: null, rate_handwritten: l.handwritten,
      page: l.page, snippet: `${l.serial} ${l.unit} ${l.quantity} ${l.rate}`, confidence: l.handwritten ? 0.6 : 0.95,
    })),
    stated_totals: q.stated_totals.map((t) => ({ ...t, snippet: `${t.label} ${t.amount}` })),
    terms: TERM_KEYS.map((k) => ({ term: k, status: (q.terms as Record<string, TermStatus>)[k], detail: "", page: null, snippet: null })),
    vendor_conditions: [],
    is_scanned: q.scanned,
    reader_notes: "",
  };
}

/** A second read of the handwritten rates. `override` replaces the rate read for given serials. */
export function fixtureSecondRead(vendor: FixtureVendor, override: Record<string, number | null> = {}): HandwrittenRates {
  return {
    rates: fixtureFor(vendor).lines.filter((l) => l.handwritten).map((l) => {
      const rate = l.serial in override ? override[l.serial] : l.rate;
      return { serial: l.serial, rate, legible: rate != null, page: l.page };
    }),
  };
}
