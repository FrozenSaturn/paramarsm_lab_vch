import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreComparative } from "./index";
import { vendorFacts, validityDaysLeft, type FactsExtra } from "./facts";
import { riskFlags, median } from "./risk";
import { scoreVendors, priceScore, responsivenessScore, complianceScore, commercialScore, deliveryFitScore, pastPerformanceScore } from "./score";
import { validateWeights, normaliseWeights, setWeight, weightsForCategory, sumWeights } from "./weights";
import { DEFAULT_WEIGHTS, NEUTRAL_SCORE, PARAMS, type VendorFacts, type VendorScore } from "./types";
import { makeCase, amaraLike, BOQ_LINES } from "./testkit";
import { round } from "@/quotes/units";

const noExtra: FactsExtra = { performance: {}, reminders: {}, required_days: null };
const param = (s: VendorScore, p: string) => s.params.find((x) => x.param === p)!;
const byId = (scores: VendorScore[], id: string) => scores.find((s) => s.vendor_id === id)!;

/** A facts object with every input present; tests change one field at a time. */
const baseFacts = (over: Partial<VendorFacts> = {}): VendorFacts => ({
  vendor_id: "v1", landed_for_price: 1000, lowest_landed_for_price: 1000,
  terms: ["met", "met", "met", "met", "met", "met"].map((status, i) => ({ term: `t${i}`, status: status as "met" })),
  boq_lines: 7, lines_missing: 0, completion_days: 30, required_days: 30,
  rfq_sent_at: "2026-11-16T05:00:00.000Z", received_at: "2026-11-17T05:00:00.000Z", stale: false, reminders_sent: 0,
  advance_pct: 0, payment_days: 30, validity_days_left: 30, warranty_months: 60, performance: [],
  ...over,
});

test("weights: validate, normalise, set one, pick by category", () => {
  assert.deepEqual(validateWeights({ ...DEFAULT_WEIGHTS }), DEFAULT_WEIGHTS);
  assert.throws(() => validateWeights({ ...DEFAULT_WEIGHTS, price: 41 }), /add up to 100/);
  assert.throws(() => validateWeights({ ...DEFAULT_WEIGHTS, price: -1, commercial: 46 }), /negative/);
  assert.throws(() => validateWeights({ price: 100 }), /missing/);
  assert.throws(() => validateWeights({ ...DEFAULT_WEIGHTS, speed: 0 }), /Unknown/);
  assert.throws(() => validateWeights({ ...DEFAULT_WEIGHTS, price: "40" }), /number/);
  assert.throws(() => validateWeights(null), /object/);

  const n = normaliseWeights({ price: 1, past_performance: 1, delivery_fit: 1 });
  assert.equal(sumWeights(n), 100);
  assert.equal(n.compliance, 0);
  validateWeights(n);

  const s = setWeight(DEFAULT_WEIGHTS, "price", 60);
  assert.equal(s.price, 60);
  assert.equal(round(sumWeights(s)), 100);
  assert.equal(s.past_performance, round(20 * 40 / 60));

  const rows = [{ category: "default", weights: DEFAULT_WEIGHTS }, { category: "Waterproofing", weights: { ...DEFAULT_WEIGHTS, price: 50, past_performance: 10 } }];
  assert.equal(weightsForCategory(rows, "waterproofing").price, 50);
  assert.equal(weightsForCategory(rows, "civil").price, 40);
  assert.equal(weightsForCategory(rows, null).price, 40);
  assert.deepEqual(weightsForCategory([], "civil"), DEFAULT_WEIGHTS);
  assert.throws(() => weightsForCategory([{ category: "default", weights: { price: 1 } }]), /scoring_weights for "default"/);
});

test("price: 100 × lowest ÷ this, with loading in landed_for_price", () => {
  assert.equal(priceScore(baseFacts()).score, 100);
  const p = priceScore(baseFacts({ landed_for_price: 1250, lowest_landed_for_price: 1000 }));
  assert.equal(p.score, 80);
  assert.match(p.explain, /₹1,250\.00 against the lowest ₹1,000\.00/);
  assert.equal(priceScore(baseFacts({ landed_for_price: 0 })).neutral, true);
});

test("past performance: mean rating mapped 1→0, 5→100; no history and demo labels", () => {
  const none = pastPerformanceScore(baseFacts());
  assert.deepEqual([none.score, none.neutral, none.label], [NEUTRAL_SCORE, true, "no history"]);
  const allNull = pastPerformanceScore(baseFacts({ performance: [{ id: "p0", quality: null, timeliness: null, disputes: null, safety: null, is_demo: false }] }));
  assert.equal(allNull.label, "no history");
  const real = pastPerformanceScore(baseFacts({ performance: [
    { id: "p1", quality: 4, timeliness: 3, disputes: 5, safety: null, is_demo: false },
    { id: "p2", quality: 4, timeliness: 4, disputes: null, safety: 4, is_demo: false },
  ] }));
  // ratings 4,3,5,4,4,4 → mean 4 → 75
  assert.deepEqual([real.score, real.neutral, real.label], [75, false, null]);
  const demo = pastPerformanceScore(baseFacts({ performance: [{ id: "p3", quality: 1, timeliness: 1, disputes: 1, safety: 1, is_demo: true }] }));
  assert.deepEqual([demo.score, demo.label], [0, "demo data"]);
});

test("delivery fit: within required → 100, linear to 0 at 2×, neutral without a required date", () => {
  assert.equal(deliveryFitScore(baseFacts({ completion_days: 25 })).score, 100);
  assert.equal(deliveryFitScore(baseFacts({ completion_days: 45 })).score, 50);
  assert.equal(deliveryFitScore(baseFacts({ completion_days: 60 })).score, 0);
  assert.equal(deliveryFitScore(baseFacts({ completion_days: 90 })).score, 0);
  const noReq = deliveryFitScore(baseFacts({ required_days: null }));
  assert.deepEqual([noReq.score, noReq.neutral, noReq.label], [50, true, "no required date"]);
  assert.equal(deliveryFitScore(baseFacts({ completion_days: null })).label, "completion not stated");
});

test("compliance: terms average minus 100 ÷ BOQ lines per missing line, floor 0", () => {
  assert.equal(complianceScore(baseFacts()).score, 100);
  const mixed = baseFacts({ terms: ["not_stated", "not_stated", "not_stated", "met", "not_met", "not_stated"].map((status, i) => ({ term: `t${i}`, status: status as any })) });
  assert.equal(complianceScore(mixed).score, 50);
  const missing = complianceScore({ ...mixed, lines_missing: 1 });
  assert.equal(missing.score, round(50 - 100 / 7));
  assert.match(missing.explain, /1 of 7 BOQ lines missing/);
  assert.equal(complianceScore({ ...mixed, lines_missing: 7 }).score, 0);
});

test("responsiveness: bands, stale, no RFQ time, reminders", () => {
  const at = (h: number) => new Date(Date.parse("2026-11-16T05:00:00.000Z") + h * 3_600_000).toISOString();
  assert.equal(responsivenessScore(baseFacts({ received_at: at(48) })).score, 100);
  assert.equal(responsivenessScore(baseFacts({ received_at: at(192) })).score, 50);
  assert.equal(responsivenessScore(baseFacts({ received_at: at(336) })).score, 0);
  assert.equal(responsivenessScore(baseFacts({ received_at: at(500) })).score, 0);
  assert.equal(responsivenessScore(baseFacts({ received_at: at(72) })).score, round(100 * (336 - 72) / 288));
  const stale = responsivenessScore(baseFacts({ stale: true }));
  assert.deepEqual([stale.score, stale.neutral, stale.label], [50, true, "not priced for this RFQ"]);
  assert.equal(responsivenessScore(baseFacts({ rfq_sent_at: null })).label, "no RFQ send time");
  const rem = responsivenessScore(baseFacts({ received_at: at(10), reminders_sent: 2 }));
  assert.equal(rem.score, 80);
  assert.match(rem.explain, /2 reminders take off 20/);
  assert.equal(responsivenessScore(baseFacts({ stale: true, reminders_sent: 6 })).score, 0);
});

test("commercial: sub-score bands, mean of those stated, neutral when none", () => {
  assert.equal(commercialScore(baseFacts()).score, 100);
  // advance 25 → 50, payment 30 → 100, validity lapsed → 0, warranty 120 → 100
  assert.equal(commercialScore(baseFacts({ advance_pct: 25, payment_days: 30, validity_days_left: -143, warranty_months: 120 })).score, 62.5);
  // advance 50 → 25, payment 7 → 50; validity and warranty not stated
  assert.equal(commercialScore(baseFacts({ advance_pct: 50, payment_days: 7, validity_days_left: null, warranty_months: null })).score, 37.5);
  assert.equal(commercialScore(baseFacts({ advance_pct: 10, payment_days: 15, validity_days_left: 5, warranty_months: 12 })).score, round((75 + 75 + 50 + 75) / 4));
  assert.equal(commercialScore(baseFacts({ advance_pct: null, payment_days: 0, validity_days_left: null, warranty_months: 6 })).score, round((25 + 50) / 2));
  const none = commercialScore(baseFacts({ advance_pct: null, payment_days: null, validity_days_left: null, warranty_months: null }));
  assert.deepEqual([none.score, none.neutral, none.label], [50, true, "terms not stated"]);
});

test("facts from the Amara-like case: stale, validity, parsed terms, loading", () => {
  const { matrix, input } = makeCase(amaraLike());
  const facts = vendorFacts(matrix, input, noExtra);
  assert.deepEqual(facts.map((f) => f.vendor_id), ["v-bajrang", "v-purv", "v-sk", "v-shyama"], "matrix vendor order (by name)");
  const f = Object.fromEntries(facts.map((x) => [x.vendor_id, x]));
  assert.equal(f["v-bajrang"].stale, true);
  assert.equal(f["v-sk"].stale, true);
  assert.equal(f["v-purv"].stale, false);
  assert.equal(f["v-shyama"].stale, false, "no quote date is not stale");
  assert.equal(f["v-bajrang"].validity_days_left, 45 - 188);
  assert.equal(f["v-bajrang"].advance_pct, 25);
  assert.equal(f["v-bajrang"].payment_days, 30);
  assert.equal(f["v-bajrang"].warranty_months, 120);
  assert.equal(f["v-bajrang"].lines_missing, 1);
  assert.equal(f["v-bajrang"].landed_for_price, round((1376412.01 + 150000) * 1.18));
  assert.equal(f["v-sk"].lowest_landed_for_price, round(1381464 * 1.18));
  assert.equal(validityDaysLeft({ valid_until: "2026-12-05", validity_days: null, quote_date: null, received_at: null }, "2026-11-25"), 10);
  assert.equal(validityDaysLeft({ valid_until: null, validity_days: 30, quote_date: null, received_at: null }, "2026-11-25"), null);
});

test("Amara-like scores: each parameter, total = Σ contributions, ranks", () => {
  const { matrix, input } = makeCase(amaraLike());
  const { scores, risk } = scoreComparative(matrix, input, noExtra, DEFAULT_WEIGHTS);
  const low = round(1381464 * 1.18);
  for (const s of scores) {
    assert.equal(s.total, round(s.params.reduce((a, p) => a + p.contribution, 0)));
    for (const p of s.params) assert.equal(p.contribution, round((p.weight * p.score) / 100));
    assert.deepEqual(s.params.map((p) => p.param), [...PARAMS]);
    assert.deepEqual(s.risk_flags, risk[s.vendor_id]);
    assert.equal(param(s, "past_performance").label, "no history");
    assert.equal(param(s, "delivery_fit").label, "no required date");
  }
  const sk = byId(scores, "v-sk"), baj = byId(scores, "v-bajrang"), purv = byId(scores, "v-purv"), shy = byId(scores, "v-shyama");
  assert.equal(param(sk, "price").score, 100);
  assert.equal(param(baj, "price").score, round((100 * low) / round(1526412.01 * 1.18)), "Bajrang's missing line is loaded, so it does not win on price");
  assert.equal(param(baj, "responsiveness").label, "not priced for this RFQ");
  assert.equal(param(purv, "responsiveness").score, round(100 * (336 - 72) / 288));
  assert.equal(param(baj, "compliance").score, round(50 - 100 / BOQ_LINES));
  assert.equal(param(baj, "commercial").score, 62.5);
  assert.equal(param(purv, "commercial").score, 37.5);
  assert.equal(param(shy, "commercial").label, "terms not stated");
  assert.equal(param(sk, "compliance").score, 50);
  assert.deepEqual(scores.map((s) => s.rank), [1, 2, 3, 4]);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1].total >= scores[i].total);
  assert.equal(scores[0].vendor_id, "v-sk");
});

test("tie-break: lower landed_for_price, then lower vendor_id", () => {
  const f = (id: string, landed: number, over: Partial<VendorFacts> = {}) => baseFacts({ vendor_id: id, landed_for_price: landed, lowest_landed_for_price: 1000, ...over });
  const x = f("x", 1200), y = f("y", 1200), z = f("z", 1000, { lowest_landed_for_price: 1000 });
  // x and y identical (same total, same landed) → vendor_id decides.
  const r = scoreVendors([y, x, z], DEFAULT_WEIGHTS, { rankingWithheld: false, risk: {} });
  assert.deepEqual(r.map((s) => [s.vendor_id, s.rank]), [["z", 1], ["x", 2], ["y", 3]]);

  // Same total, different landed: the price weight is 0, so only landed decides.
  const w0 = { ...DEFAULT_WEIGHTS, price: 0, commercial: 45 };
  const r2 = scoreVendors([f("a", 1500), f("b", 1100)], w0, { rankingWithheld: false, risk: {} });
  assert.equal(r2[0].total, r2[1].total);
  assert.deepEqual(r2.map((s) => s.vendor_id), ["b", "a"]);
});

test("withheld ranking: every rank null, vendor_id order, fewer_than_three flag", () => {
  const { matrix, input } = makeCase(amaraLike().slice(0, 2));
  assert.equal(matrix.ranking_withheld, true);
  const { scores } = scoreComparative(matrix, input, noExtra, DEFAULT_WEIGHTS);
  assert.deepEqual(scores.map((s) => s.rank), [null, null]);
  assert.deepEqual(scores.map((s) => s.vendor_id), ["v-bajrang", "v-purv"]);
  for (const s of scores) assert.ok(s.risk_flags.some((r) => r.code === "fewer_than_three"));
});

test("risk flags: stale, scope, far below median, handwriting, lapsed, lines missing", () => {
  const specs = amaraLike();
  specs[1].scope = "different";
  specs.push({ id: "v-cheap", name: "Zed Cheap Works", before_gst: 900000 });
  const { matrix, input } = makeCase(specs);
  const facts = vendorFacts(matrix, input, noExtra);
  const risk = riskFlags(matrix, input, facts);
  const codes = (id: string) => risk[id].map((r) => r.code);
  assert.deepEqual(codes("v-bajrang"), ["stale", "lines_missing", "validity_lapsed"]);
  assert.deepEqual(codes("v-purv"), ["different_scope"]);
  assert.deepEqual(codes("v-sk"), ["unconfirmed_handwriting", "stale"]);
  assert.equal(risk["v-sk"][0].severity, "block");
  assert.deepEqual(codes("v-shyama"), []);
  const med = median(Object.values(matrix.totals).map((t) => t.landed_for_price))!;
  assert.ok(matrix.totals["v-cheap"].landed_for_price < 0.8 * med);
  assert.deepEqual(codes("v-cheap"), ["far_below_median"]);
  assert.match(risk["v-cheap"][0].message, /% of the median/);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("risk flags never change the score", () => {
  const { matrix, input } = makeCase(amaraLike());
  const facts = vendorFacts(matrix, input, noExtra);
  const a = scoreVendors(facts, DEFAULT_WEIGHTS, { rankingWithheld: false, risk: riskFlags(matrix, input, facts) });
  const b = scoreVendors(facts, DEFAULT_WEIGHTS, { rankingWithheld: false, risk: {} });
  assert.deepEqual(a.map((s) => [s.vendor_id, s.total, s.rank]), b.map((s) => [s.vendor_id, s.total, s.rank]));
});

test("performance and reminders change only their own parameters; demo label shows", () => {
  const { matrix, input } = makeCase(amaraLike());
  const extra: FactsExtra = {
    performance: { "v-shyama": [{ id: "p1", quality: 5, timeliness: 5, disputes: 5, safety: 5, is_demo: true }] },
    reminders: { "v-purv": 1 }, required_days: 30,
  };
  const { scores } = scoreComparative(matrix, input, extra, DEFAULT_WEIGHTS);
  const shy = byId(scores, "v-shyama"), purv = byId(scores, "v-purv");
  assert.deepEqual([param(shy, "past_performance").score, param(shy, "past_performance").label], [100, "demo data"]);
  assert.equal(param(purv, "responsiveness").score, round(100 * (336 - 72) / 288 - 10));
  assert.equal(param(purv, "delivery_fit").label, "completion not stated");
});

test("determinism: same input and weights give byte-identical JSON", () => {
  const run = () => {
    const { matrix, input } = makeCase(amaraLike());
    return JSON.stringify(scoreComparative(matrix, input, noExtra, DEFAULT_WEIGHTS));
  };
  assert.equal(run(), run());
  const { matrix, input } = makeCase(amaraLike());
  const shuffled = { ...input, quotes: [...input.quotes].reverse() };
  assert.equal(JSON.stringify(scoreComparative(matrix, shuffled, noExtra, DEFAULT_WEIGHTS)), run());
});
