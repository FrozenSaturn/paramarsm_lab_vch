/**
 * "What if" re-ranking (PLAN.md section 7.4). It uses only the stored parameter scores and
 * new weights, so the browser runs it with no model call and no database. Plain code with
 * no server imports.
 */
import { applyRanks, contribution, totalOf } from "./score";
import { PARAMS, type VendorScore, type Weights } from "./types";
import { validateWeights } from "./weights";

/** True when the stored scores come from a comparison with the ranking withheld. */
export const isWithheld = (scores: VendorScore[]) =>
  scores.some((s) => s.risk_flags.some((r) => r.code === "fewer_than_three")) || (scores.length > 0 && scores.every((s) => s.rank === null));

/**
 * Recomputes contributions, totals and ranks with new weights. Parameter scores, labels,
 * explanations, inputs and risk flags stay as stored. Throws when the weights are not valid.
 * The result equals scoreVendors over the same facts with the new weights.
 */
export function rerank(scores: VendorScore[], weights: Weights): VendorScore[] {
  const w = validateWeights(weights);
  const updated = scores.map((s) => {
    const byParam = new Map(s.params.map((p) => [p.param, p]));
    const params = PARAMS.flatMap((param) => {
      const p = byParam.get(param);
      return p ? [{ ...p, weight: w[param], contribution: contribution(w[param], p.score) }] : [];
    });
    return { ...s, params, total: totalOf(params) };
  });
  return applyRanks(updated, isWithheld(scores));
}
