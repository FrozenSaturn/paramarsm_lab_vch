/**
 * Scoring shapes (PLAN.md section 7.4). Scores are computed by code from computed facts.
 * The same facts and weights always give the same scores, so "what if" can re-rank in the
 * browser without a new model call.
 *
 * Decisions (user, 2026-11-21): each parameter scores 0–100. When its input is missing the
 * score is NEUTRAL_SCORE with a visible label; the weights do not change. Risk flags sit
 * beside the score and never change it.
 */

export const PARAMS = ["price", "past_performance", "delivery_fit", "compliance", "responsiveness", "commercial"] as const;
export type Param = (typeof PARAMS)[number];
export type Weights = Record<Param, number>;

export const DEFAULT_WEIGHTS: Weights = {
  price: 40, past_performance: 20, delivery_fit: 15, compliance: 10, responsiveness: 10, commercial: 5,
};
export const NEUTRAL_SCORE = 50;

export const PARAM_LABELS: Record<Param, string> = {
  price: "Price", past_performance: "Past performance", delivery_fit: "Delivery fit",
  compliance: "Compliance", responsiveness: "Responsiveness", commercial: "Commercial terms",
};

/** A confirmed or seeded `vendor_performance` row. Ratings are 1–5, 5 is best (for disputes, 5 means none). */
export interface PerformanceRecord {
  id: string;
  quality: number | null;
  timeliness: number | null;
  disputes: number | null;
  safety: number | null;
  is_demo: boolean;
}

/** The facts one vendor is scored on. Built from the matrix and a few rows; no model output enters here unreviewed. */
export interface VendorFacts {
  vendor_id: string;
  /** From the matrix: landed_for_price of this vendor and the lowest across vendors. */
  landed_for_price: number;
  lowest_landed_for_price: number;
  /** The six RFQ terms. */
  terms: { term: string; status: "met" | "not_met" | "not_stated" }[];
  boq_lines: number;
  lines_missing: number;
  /** Days to complete as stated by the vendor (parsed by code), and the case's required days. */
  completion_days: number | null;
  required_days: number | null;
  /** RFQ send time and quote arrival time (ISO). */
  rfq_sent_at: string | null;
  received_at: string | null;
  /** True when the quote is dated before the RFQ went out: it was not priced for this RFQ. */
  stale: boolean;
  reminders_sent: number;
  /** Commercial inputs, parsed by code from the quote. Null when not stated. */
  advance_pct: number | null;
  payment_days: number | null;
  validity_days_left: number | null;
  warranty_months: number | null;
  performance: PerformanceRecord[];
}

export interface ParamScore {
  param: Param;
  /** 0–100, 2 places. */
  score: number;
  weight: number;
  /** weight × score / 100, 2 places. */
  contribution: number;
  /** True when the input was missing and the score is NEUTRAL_SCORE. */
  neutral: boolean;
  /** Short visible label, e.g. "no history", "no required date", "demo data". */
  label: string | null;
  /** One sentence a person can check against the inputs, e.g. "₹13,81,464 is 100% of the lowest". */
  explain: string;
  inputs: Record<string, unknown>;
}

export type RiskCode =
  | "stale" | "different_scope" | "far_below_median" | "unconfirmed_handwriting"
  | "validity_lapsed" | "lines_missing" | "fewer_than_three";

export interface RiskFlag {
  code: RiskCode;
  severity: "warn" | "block";
  message: string;
}

export interface VendorScore {
  vendor_id: string;
  /** Sum of contributions, 2 places. */
  total: number;
  /** 1 = top. A tie on total goes to the lower landed_for_price, then the lower vendor_id. Null when the ranking is withheld. */
  rank: number | null;
  params: ParamScore[];
  risk_flags: RiskFlag[];
}
