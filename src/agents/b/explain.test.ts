import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatrix } from "@/compare/matrix";
import { compareInputFromFixtures } from "@/compare/fixtures";
import { buildRecommendationFacts, topVendors, type RecommendationFact } from "@/compare/recommend-facts";
import { scoreComparative } from "@/scoring";
import { DEFAULT_WEIGHTS } from "@/scoring/types";
import { numberTokens, templateExplanation, validateExplanation, type Explanation } from "./explain-check";
import { writeExplanation } from "./explain";

function setup() {
  const input = compareInputFromFixtures();
  const matrix = buildMatrix(input);
  const { scores } = scoreComparative(matrix, input, { performance: {}, reminders: {}, required_days: null }, DEFAULT_WEIGHTS);
  const facts = buildRecommendationFacts(matrix, scores, { comparativeId: "cmp-1", weights: DEFAULT_WEIGHTS });
  const top = topVendors(matrix, scores).map((s) => s.vendor_id);
  return { facts, top };
}

const fact = (id: string, text: string, vendor_id?: string): RecommendationFact => ({ id, kind: "rank", text, vendor_id, proof: { type: "comparative", comparative_id: "c" } });

test("numberTokens reads Indian amounts, percents and dates and skips fact ids", () => {
  assert.deepEqual(numberTokens("₹13,81,464.00 at 18% (F12)").map((t) => t.value), [1381464, 18]);
  assert.deepEqual(numberTokens("dated 21.05.2026").map((t) => t.raw), ["21.05", "2026"]);
});

test("template explanation passes validation and gives 2 to 4 reasons for each top vendor", () => {
  const { facts, top } = setup();
  const e = templateExplanation(facts, top);
  assert.deepEqual(validateExplanation(e, facts, top), []);
  assert.deepEqual(e.vendors.map((v) => v.vendor_id), top);
  for (const v of e.vendors) assert.ok(v.reasons.length >= 2 && v.reasons.length <= 4);
  assert.equal(JSON.stringify(e), JSON.stringify(templateExplanation(facts, top)));
});

test("validation: unknown fact id, missing fact ids, unknown vendor and missing vendor are errors", () => {
  const facts = [fact("F1", "A ranks 1 of 3 with a score of 78.5 out of 100.", "a"), fact("F2", "B ranks 2 of 3 with a score of 70 out of 100.", "b")];
  const ok: Explanation = {
    summary: [{ text: "A has the highest score, 78.5.", fact_ids: ["F1"] }],
    vendors: [
      { vendor_id: "a", reasons: [{ text: "A scores 78.5.", fact_ids: ["F1"] }, { text: "A ranks above B.", fact_ids: ["F1", "F2"] }] },
      { vendor_id: "b", reasons: [{ text: "B scores 70.", fact_ids: ["F2"] }, { text: "B ranks 2.", fact_ids: ["F2"] }] },
    ],
  };
  assert.deepEqual(validateExplanation(ok, facts, ["a", "b"]), []);
  const bad = structuredClone(ok);
  bad.summary[0].fact_ids = ["F9"];
  bad.vendors[0].reasons[0].fact_ids = [];
  bad.vendors[1].vendor_id = "z";
  const errs = validateExplanation(bad, facts, ["a", "b"]);
  assert.ok(errs.some((e) => /unknown fact id F9/.test(e)));
  assert.ok(errs.some((e) => /cites no fact id/.test(e)));
  assert.ok(errs.some((e) => /Vendor z is not one of the top vendors/.test(e)));
  assert.ok(errs.some((e) => /Vendor b has no reasons/.test(e)));
});

test("validation: a number not in the cited facts is an error; formatting and rounding are tolerated", () => {
  const facts = [fact("F1", "A's landed total is ₹16,30,127.52 with GST at 18%.", "a"), fact("F2", "Quote dated 21.05.2026.", "a")];
  const one = (text: string, ids = ["F1"]): Explanation => ({ summary: [{ text, fact_ids: ids }], vendors: [{ vendor_id: "a", reasons: [{ text: "A ok.", fact_ids: ["F1"] }, { text: "A dated.", fact_ids: ["F2"] }] }] });
  assert.deepEqual(validateExplanation(one("A lands at ₹16,30,127.52 including 18% GST."), facts, ["a"]), []);
  assert.deepEqual(validateExplanation(one("A lands at about ₹16,30,128."), facts, ["a"]), []);
  assert.deepEqual(validateExplanation(one("The quote is dated 21 May 2026.", ["F2"]), facts, ["a"]), []);
  const errs = validateExplanation(one("A lands at ₹15,00,000, 8% cheaper."), facts, ["a"]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /15,00,000/);
  assert.match(errs[0], /\b8\b/);
  // A number from a fact that the sentence does not cite is still an error.
  assert.equal(validateExplanation(one("A lands at ₹16,30,127.52 on 21.05.2026."), facts, ["a"]).length, 1);
});

test("validation: reasons count must be 2 to 4", () => {
  const facts = [fact("F1", "A scores 70.", "a")];
  const e: Explanation = { summary: [{ text: "A scores 70.", fact_ids: ["F1"] }], vendors: [{ vendor_id: "a", reasons: [{ text: "A scores 70.", fact_ids: ["F1"] }] }] };
  assert.ok(validateExplanation(e, facts, ["a"]).some((x) => /1 reasons; give 2 to 4/.test(x)));
});

test("writeExplanation without an API key uses the template (no network)", async () => {
  const { facts, top } = setup();
  const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const r = await writeExplanation(facts, { vendors: top.map((vendor_id) => ({ vendor_id, name: vendor_id })) });
    assert.equal(r.source, "template");
    assert.equal(r.model, null);
    assert.equal(r.prompt_version, "w6-explain-v1");
    assert.deepEqual(validateExplanation(r.explanation, facts, top), []);
  } finally {
    if (saved.k !== undefined) process.env.ANTHROPIC_API_KEY = saved.k;
    if (saved.t !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.t;
  }
});
