/**
 * Shapes of the comparative statement (PLAN.md section 7.3). Plain data only, so the
 * matrix is stored as JSON on `comparatives.matrix`, rendered by the panel, written to
 * Excel, and re-derived by tests from the same inputs.
 *
 * Rule: code does the arithmetic. Every amount here is rate × Vinayak's quantity,
 * rounded to 2 places, and every total is a sum of amounts shown in the matrix.
 */
import type { Flag } from "@/quotes/normalise";
import type { TermKey, TermStatus } from "@/quotes/terms";

/** One BOQ line as Vinayak measured it. */
export interface CompareBoqLine {
  id: string | null;
  serial: string;
  description: string;
  /** Unit every vendor is compared in: the BOQ's own unit (SQFT, RMT). The matrix converts each vendor rate into it, so amounts equal rate × Vinayak's quantity exactly. */
  unit: string | null;
  /** Vinayak's quantity in `unit`. */
  quantity: number | null;
}

/** One quote line as W5 stored it in `quote_lines` (after confirmations). */
export interface CompareQuoteLine {
  id: string | null;
  boq_line_id: string | null;
  /** BOQ serial the line answers; used when boq_line_id is null (fixtures). */
  boq_serial: string | null;
  serial: string | null;
  item: string | null;
  unit_raw: string | null;
  quantity: number | null;
  rate: number | null;
  /** Vendor rate per `normalized_unit`. Null when the unit cannot be converted. */
  normalized_rate: number | null;
  normalized_unit: string | null;
  make: string | null;
  page: number | null;
  rate_handwritten: boolean;
  /** True when a person confirmed or corrected this line's rate in the review screen. */
  rate_confirmed: boolean;
  flags: Flag[];
}

export interface CompareTerm {
  term: TermKey;
  status: TermStatus;
  detail: string | null;
}

/** One vendor's live quote: the newest version that is `ready` or `needs_review`. */
export interface CompareQuote {
  quote_id: string;
  vendor_id: string;
  vendor_name: string;
  version: number;
  status: "ready" | "needs_review";
  document_id: string | null;
  quote_date: string | null;
  /** When the quote reached us (ISO timestamp): the message or document time, else the quotes row time. */
  received_at: string | null;
  scope: "matches" | "close" | "different" | "unknown";
  gst_treatment: "extra" | "inclusive" | "not_stated";
  /** GST rate as a fraction (0.18). Null means not stated; the matrix then uses STANDARD_GST_RATE. */
  gst_rate: number | null;
  validity_days: number | null;
  valid_until: string | null;
  payment_terms: string | null;
  advance: string | null;
  completion_time: string | null;
  mobilisation: string | null;
  warranty: string | null;
  needs_review: boolean;
  flags: Flag[];
  lines: CompareQuoteLine[];
  terms: CompareTerm[];
}

/** Everything the matrix is built from. The loader fills it from the database; tests fill it from fixtures. */
export interface CompareInput {
  case_id: string;
  rfq_id: string | null;
  boq_version_id: string | null;
  /** When the RFQ went out (ISO). */
  rfq_sent_at: string | null;
  /** RFQ due date (ISO date). The comparison's "as of" date: validity and lateness are judged against it. */
  rfq_due_date: string | null;
  boq: CompareBoqLine[];
  quotes: CompareQuote[];
}

export interface MatrixCell {
  quote_line_id: string | null;
  /** Vendor's own unit and rate, as printed. */
  unit_raw: string | null;
  rate_raw: number | null;
  /** Vendor's rate in the row's unit. Null when not comparable. */
  rate: number | null;
  /** rate × row quantity, 2 places. Null when not comparable. */
  amount: number | null;
  /** True when no other vendor has a lower amount on this row (ties are all lowest). */
  lowest: boolean;
  /** Line was not quoted or cannot be compared, so the price comparison uses `loaded_amount`. */
  missing: boolean;
  /** For a missing cell: highest comparable amount among the other vendors on this row (tender "loading"). */
  loaded_amount: number | null;
  page: number | null;
  handwritten: boolean;
  confirmed: boolean;
  flags: Flag[];
}

export interface MatrixRow {
  boq_line_id: string | null;
  serial: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  /** Keyed by vendor_id. Every vendor in the matrix has a cell on every row. */
  cells: Record<string, MatrixCell>;
  lowest_vendor_ids: string[];
}

export interface MatrixTotals {
  vendor_id: string;
  /** Sum of comparable amounts on Vinayak's quantities. */
  before_gst: number;
  gst_rate: number;
  gst_basis: "extra" | "inclusive" | "assumed_standard";
  gst: number;
  /** before_gst + gst. */
  landed: number;
  lines_priced: number;
  lines_missing: string[];
  /** Sum of loaded amounts for missing lines (0 when complete). */
  loading: number;
  /** (before_gst + loading) × (1 + gst_rate): the basis of the price score, so a vendor gains nothing by leaving lines out. */
  landed_for_price: number;
}

export interface TermsGridRow {
  term: TermKey;
  label: string;
  /** Keyed by vendor_id. */
  cells: Record<string, { status: TermStatus; detail: string | null }>;
}

export interface MatrixVendor {
  vendor_id: string;
  name: string;
  quote_id: string;
  version: number;
  status: "ready" | "needs_review";
  document_id: string | null;
  quote_date: string | null;
  received_at: string | null;
  scope: CompareQuote["scope"];
  flags: Flag[];
}

export interface Matrix {
  schema_version: 1;
  case_id: string;
  rfq_id: string | null;
  boq_version_id: string | null;
  as_of: string | null;
  currency: "INR";
  /** Ordered by vendor name, so the same inputs give the same JSON. */
  vendors: MatrixVendor[];
  rows: MatrixRow[];
  /** Keyed by vendor_id. */
  totals: Record<string, MatrixTotals>;
  /** Vendor with the lowest landed_for_price (null when no vendor). */
  lowest_landed_vendor_id: string | null;
  terms: TermsGridRow[];
  /** Plain-language notes, e.g. "Fewer than three quotes: the SOP needs three before a ranking." */
  notes: string[];
  /** True when fewer than MIN_QUOTES quotes went in: scores are shown, the ranking is withheld. */
  ranking_withheld: boolean;
}

export const STANDARD_GST_RATE = 0.18;
export const MIN_QUOTES = 3;
