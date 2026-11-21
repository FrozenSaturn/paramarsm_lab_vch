/**
 * Scoring for one comparative: facts → risk flags → scores. Plain code, no database.
 * The same matrix, input, extra and weights always give the same result.
 */
import type { CompareInput, Matrix } from "@/compare/types";
import { vendorFacts, type FactsExtra } from "./facts";
import { riskFlags } from "./risk";
import { scoreVendors } from "./score";
import type { RiskFlag, VendorFacts, VendorScore, Weights } from "./types";
import { validateWeights } from "./weights";

export interface ScoringResult {
  facts: VendorFacts[];
  scores: VendorScore[];
  /** Keyed by vendor_id. The same flags are on each VendorScore.risk_flags. */
  risk: Record<string, RiskFlag[]>;
}

/** Scores every vendor in the matrix. Throws when the weights are not valid. */
export function scoreComparative(matrix: Matrix, input: CompareInput, extra: FactsExtra, weights: Weights): ScoringResult {
  const w = validateWeights(weights);
  const facts = vendorFacts(matrix, input, extra);
  const risk = riskFlags(matrix, input, facts);
  const scores = scoreVendors(facts, w, { rankingWithheld: matrix.ranking_withheld, risk });
  return { facts, scores, risk };
}

export type { FactsExtra } from "./facts";
export { vendorFacts, asOfDate, isStale, validityDaysLeft } from "./facts";
export { riskFlags, median, FAR_BELOW_MEDIAN_RATIO } from "./risk";
export { scoreVendors, paramScores } from "./score";
export { rerank } from "./whatif";
export { validateWeights, normaliseWeights, setWeight, weightsForCategory, sumWeights, sameWeights } from "./weights";
export { parseDays, parseCompletionDays, parseAdvancePct, parsePaymentDays, parseWarrantyMonths } from "./parse";
export * from "./types";
