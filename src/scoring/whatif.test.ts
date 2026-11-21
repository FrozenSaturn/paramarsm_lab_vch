import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreComparative } from "./index";
import { rerank } from "./whatif";
import { scoreVendors } from "./score";
import { vendorFacts, type FactsExtra } from "./facts";
import { riskFlags } from "./risk";
import { setWeight } from "./weights";
import { DEFAULT_WEIGHTS, type Weights } from "./types";
import { makeCase, amaraLike } from "./testkit";

const noExtra: FactsExtra = { performance: {}, reminders: {}, required_days: null };

const WEIGHT_SETS: Weights[] = [
  { price: 100, past_performance: 0, delivery_fit: 0, compliance: 0, responsiveness: 0, commercial: 0 },
  { price: 10, past_performance: 10, delivery_fit: 10, compliance: 30, responsiveness: 30, commercial: 10 },
  setWeight(DEFAULT_WEIGHTS, "commercial", 40),
  { price: 0, past_performance: 0, delivery_fit: 0, compliance: 0, responsiveness: 0, commercial: 100 },
];

test("rerank with new weights equals scoreVendors with those weights", () => {
  const { matrix, input } = makeCase(amaraLike());
  const extra: FactsExtra = { performance: { "v-purv": [{ id: "p1", quality: 5, timeliness: 4, disputes: 5, safety: 5, is_demo: true }] }, reminders: { "v-shyama": 2 }, required_days: null };
  const facts = vendorFacts(matrix, input, extra);
  const risk = riskFlags(matrix, input, facts);
  const stored = scoreVendors(facts, DEFAULT_WEIGHTS, { rankingWithheld: matrix.ranking_withheld, risk });
  for (const w of WEIGHT_SETS) {
    const fresh = scoreVendors(facts, w, { rankingWithheld: matrix.ranking_withheld, risk });
    assert.deepEqual(rerank(stored, w), fresh);
    assert.equal(JSON.stringify(rerank(stored, w)), JSON.stringify(fresh));
  }
  assert.deepEqual(rerank(stored, DEFAULT_WEIGHTS), stored, "same weights give the same result");
});

test("rerank changes the order when the weights favour another vendor", () => {
  const { matrix, input } = makeCase(amaraLike());
  const { scores } = scoreComparative(matrix, input, noExtra, DEFAULT_WEIGHTS);
  assert.equal(scores[0].vendor_id, "v-sk");
  const commercialOnly = rerank(scores, WEIGHT_SETS[3]);
  assert.equal(commercialOnly[0].vendor_id, "v-bajrang", "Bajrang has the best commercial terms (62.5)");
  assert.deepEqual(commercialOnly.map((s) => s.rank), [1, 2, 3, 4]);
});

test("rerank keeps a withheld ranking withheld and rejects bad weights", () => {
  const { matrix, input } = makeCase(amaraLike().slice(0, 2));
  const { scores } = scoreComparative(matrix, input, noExtra, DEFAULT_WEIGHTS);
  const r = rerank(scores, WEIGHT_SETS[0]);
  assert.deepEqual(r.map((s) => s.rank), [null, null]);
  assert.throws(() => rerank(scores, { ...DEFAULT_WEIGHTS, price: 90 }), /add up to 100/);
});

test("client-safe modules import nothing from node or the server", () => {
  for (const f of ["whatif.ts", "score.ts", "weights.ts", "types.ts", "parse.ts"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const i of imports) {
      assert.ok(!i.startsWith("node:"), `${f} imports ${i}`);
      assert.ok(i.startsWith("./") || i === "@/quotes/units" || i === "@/quotes/format" || i.startsWith("@/compare/types") || i.startsWith("@/quotes/normalise") || i.startsWith("@/quotes/terms"), `${f} imports ${i}`);
    }
  }
});
