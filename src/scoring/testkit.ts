/**
 * Small hand-built Matrix and CompareInput objects for the scoring tests. They satisfy
 * src/compare/types.ts but do not use the matrix builder, so the scoring tests stand alone.
 */
import type { CompareInput, CompareQuote, Matrix, MatrixTotals } from "@/compare/types";
import { TERM_KEYS, DEFAULT_TERMS, type TermStatus } from "@/quotes/terms";
import { round } from "@/quotes/units";

export interface VendorSpec {
  id: string;
  name: string;
  /** Before GST, on the lines priced. */
  before_gst: number;
  loading?: number;
  lines_missing?: string[];
  terms?: TermStatus[];
  scope?: CompareQuote["scope"];
  handwritten_unconfirmed?: number;
  quote?: Partial<CompareQuote>;
}

export const BOQ_LINES = 7;

export function makeCase(specs: VendorSpec[], opts: { rfq_sent_at?: string | null; rfq_due_date?: string | null } = {}): { matrix: Matrix; input: CompareInput } {
  const rfq_sent_at = opts.rfq_sent_at === undefined ? "2026-11-16T05:00:00.000Z" : opts.rfq_sent_at;
  const rfq_due_date = opts.rfq_due_date === undefined ? "2026-11-25" : opts.rfq_due_date;
  const boq = Array.from({ length: BOQ_LINES }, (_, i) => ({ id: `boq-${i + 1}`, serial: String(i + 1), description: `Line ${i + 1}`, unit: "SQM", quantity: 100 }));

  const quotes: CompareQuote[] = specs.map((s) => ({
    quote_id: `q-${s.id}`, vendor_id: s.id, vendor_name: s.name, version: 1,
    status: s.handwritten_unconfirmed ? "needs_review" : "ready",
    document_id: `doc-${s.id}`, quote_date: "2026-11-19", received_at: "2026-11-19T05:00:00.000Z",
    scope: s.scope ?? "matches", gst_treatment: "extra", gst_rate: 0.18,
    validity_days: null, valid_until: null, payment_terms: null, advance: null,
    completion_time: null, mobilisation: null, warranty: null,
    needs_review: !!s.handwritten_unconfirmed, flags: [],
    lines: Array.from({ length: s.handwritten_unconfirmed ?? 0 }, (_, i) => ({
      id: `ql-${s.id}-${i}`, boq_line_id: `boq-${i + 1}`, boq_serial: String(i + 1), serial: String(i + 1), item: null,
      unit_raw: "SQFT", quantity: null, rate: 30, normalized_rate: 322.92, normalized_unit: "SQM", make: null, page: 1,
      rate_handwritten: true, rate_confirmed: false, flags: [],
    })),
    terms: TERM_KEYS.map((term, i) => ({ term, status: s.terms?.[i] ?? "not_stated", detail: null })),
    ...s.quote,
  }));

  const totals: Record<string, MatrixTotals> = {};
  for (const s of specs) {
    const gst = round(s.before_gst * 0.18);
    const loading = s.loading ?? 0;
    totals[s.id] = {
      vendor_id: s.id, before_gst: s.before_gst, gst_rate: 0.18, gst_basis: "extra", gst, landed: round(s.before_gst + gst),
      lines_priced: BOQ_LINES - (s.lines_missing?.length ?? 0), lines_missing: s.lines_missing ?? [], loading,
      landed_for_price: round((s.before_gst + loading) * 1.18),
    };
  }
  const sorted = [...specs].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const lowest = sorted.reduce<string | null>((best, s) => (best == null || totals[s.id].landed_for_price < totals[best].landed_for_price ? s.id : best), null);
  const quoteOf = (id: string) => quotes.find((q) => q.vendor_id === id)!;

  const matrix: Matrix = {
    schema_version: 1, case_id: "case-1", rfq_id: "rfq-1", boq_version_id: "boqv-1",
    as_of: rfq_due_date ?? rfq_sent_at, currency: "INR",
    vendors: sorted.map((s) => {
      const q = quoteOf(s.id);
      return { vendor_id: s.id, name: s.name, quote_id: q.quote_id, version: 1, status: q.status, document_id: q.document_id, quote_date: q.quote_date, received_at: q.received_at, scope: q.scope, flags: [] };
    }),
    rows: boq.map((b) => ({
      boq_line_id: b.id, serial: b.serial, description: b.description, unit: b.unit, quantity: b.quantity, lowest_vendor_ids: [],
      cells: Object.fromEntries(sorted.map((s) => [s.id, {
        quote_line_id: null, unit_raw: "SQM", rate_raw: null, rate: null, amount: null, lowest: false,
        missing: (s.lines_missing ?? []).includes(b.serial), loaded_amount: null, page: null, handwritten: false, confirmed: false, flags: [],
      }])),
    })),
    totals,
    lowest_landed_vendor_id: lowest,
    terms: TERM_KEYS.map((term) => ({
      term, label: DEFAULT_TERMS[term].label,
      cells: Object.fromEntries(sorted.map((s) => {
        const t = quoteOf(s.id).terms.find((x) => x.term === term)!;
        return [s.id, { status: t.status, detail: t.detail }];
      })),
    })),
    notes: [],
    ranking_withheld: specs.length < 3,
  };
  return { matrix, input: { case_id: "case-1", rfq_id: "rfq-1", boq_version_id: "boqv-1", rfq_sent_at, rfq_due_date, boq, quotes } };
}

/** Four vendors shaped like the Amara quotes: before-GST totals from W5 on Vinayak's quantities. */
export const amaraLike = (): VendorSpec[] => [
  {
    id: "v-bajrang", name: "Bajrang Construction & Waterproofing", before_gst: 1376412.01, loading: 150000, lines_missing: ["3"],
    terms: ["not_stated", "not_stated", "not_stated", "met", "not_met", "not_stated"], scope: "close",
    quote: {
      quote_date: "2026-05-21", validity_days: 45,
      payment_terms: "25% with order; RA bills paid within 30 days; final within 30 days of bills",
      advance: "25% payment along with the order", mobilisation: "Within 14 days after getting the order", warranty: "10 years on non-judicial stamp paper",
    },
  },
  {
    id: "v-purv", name: "Purvyakruti Sales & Services Pvt. Ltd.", before_gst: 1898612.0,
    terms: ["not_stated", "not_stated", "not_stated", "met", "not_met", "not_stated"], scope: "close",
    quote: {
      quote_date: "2026-11-17",
      payment_terms: "Monthly RA bills paid within 7 days; final bill within 15 days",
      advance: "50% material secured advance against supply of material at site",
    },
  },
  {
    id: "v-shyama", name: "Shyama's Prevention & Cure Co.", before_gst: 1704240.8,
    terms: ["not_stated", "not_stated", "not_stated", "met", "not_met", "not_stated"], scope: "close",
    quote: { quote_date: null, payment_terms: "Will be fixed after discussion" },
  },
  {
    id: "v-sk", name: "S.K. Construction", before_gst: 1381464.0, handwritten_unconfirmed: 2,
    quote: { quote_date: "2026-05-15", received_at: "2026-11-19T09:00:00.000Z" },
  },
];
