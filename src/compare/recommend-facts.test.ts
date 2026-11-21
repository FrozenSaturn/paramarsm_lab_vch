import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatrix } from "./matrix";
import { compareInputFromFixtures, fixtureVendorId as vid } from "./fixtures";
import { buildRecommendationFacts, orderedVendors, topVendors } from "./recommend-facts";
import { scoreComparative } from "@/scoring";
import { DEFAULT_WEIGHTS } from "@/scoring/types";
import { fmtINR } from "@/quotes/format";

const NO_EXTRA = { performance: {}, reminders: {}, required_days: null };

function amara(vendors?: Parameters<typeof compareInputFromFixtures>[0]) {
  const input = compareInputFromFixtures(vendors);
  const matrix = buildMatrix(input);
  const r = scoreComparative(matrix, input, NO_EXTRA, DEFAULT_WEIGHTS);
  return { input, matrix, scores: r.scores };
}

test("facts: numbered F1..Fn, top 3 vendors only, in rank order", () => {
  const { matrix, scores } = amara();
  const facts = buildRecommendationFacts(matrix, scores, { comparativeId: "cmp-1", weights: DEFAULT_WEIGHTS });
  facts.forEach((f, i) => assert.equal(f.id, `F${i + 1}`));
  const top = topVendors(matrix, scores).map((s) => s.vendor_id);
  assert.equal(top.length, 3);
  assert.deepEqual(scores.filter((s) => top.includes(s.vendor_id)).map((s) => s.rank).sort(), [1, 2, 3]);
  const vendorsInFacts = [...new Set(facts.filter((f) => f.vendor_id && f.kind !== "lowest_landed").map((f) => f.vendor_id))];
  assert.deepEqual(vendorsInFacts, top);
  const fourth = orderedVendors(matrix, scores)[3].vendor_id;
  assert.ok(!facts.some((f) => f.vendor_id === fourth && f.kind !== "lowest_landed"));
});

test("facts: each top vendor has rank, landed, six params, terms and scope; numbers come from the matrix", () => {
  const { matrix, scores } = amara();
  const facts = buildRecommendationFacts(matrix, scores, { comparativeId: "cmp-1" });
  for (const s of topVendors(matrix, scores)) {
    const mine = facts.filter((f) => f.vendor_id === s.vendor_id);
    assert.ok(mine.some((f) => f.kind === "rank" && f.text.includes(`ranks ${s.rank} of 4`)));
    const landed = mine.find((f) => f.kind === "landed")!;
    assert.ok(landed.text.includes(fmtINR(matrix.totals[s.vendor_id].landed)));
    assert.equal(mine.filter((f) => f.kind === "param").length, 6);
    assert.ok(mine.some((f) => f.kind === "scope"));
    for (const f of mine) assert.ok(f.proof.type);
  }
});

test("facts: Bajrang's missing line is loaded; SK's handwriting risk is a fact; lowest lines carry the PDF page", () => {
  const { matrix, scores } = amara();
  const facts = buildRecommendationFacts(matrix, scores, { comparativeId: "cmp-1", topN: 4 });
  const loading = facts.find((f) => f.kind === "loading" && f.vendor_id === vid("bajrang"));
  assert.ok(loading, "Bajrang has a loading fact");
  assert.ok(loading!.text.includes(fmtINR(matrix.totals[vid("bajrang")].loading)));
  assert.ok(facts.some((f) => f.kind === "risk" && f.key === "unconfirmed_handwriting" && f.vendor_id === vid("sk")));
  const lines = facts.filter((f) => f.kind === "lowest_line");
  assert.ok(lines.length > 0);
  for (const f of lines) {
    const row = matrix.rows.find((r) => r.serial === f.proof.row)!;
    const cell = row.cells[f.vendor_id!];
    assert.ok(cell.lowest);
    if (cell.page) assert.deepEqual([f.proof.type, f.proof.page], ["pdf_page", cell.page]);
  }
});

test("facts: term pages and messages become proof targets; no vendor-written detail enters a fact", () => {
  const { matrix, scores } = amara();
  const top = topVendors(matrix, scores)[0].vendor_id;
  const facts = buildRecommendationFacts(matrix, scores, {
    comparativeId: "cmp-1",
    termPages: { [top]: Object.fromEntries(matrix.terms.map((t) => [t.term, 2])) },
    messageIds: { [top]: "msg-1" },
  });
  const terms = facts.filter((f) => f.vendor_id === top && (f.kind === "terms_met" || f.kind === "term_not_met"));
  for (const f of terms) assert.equal(f.proof.page, 2);
  const resp = facts.find((f) => f.vendor_id === top && f.key === "responsiveness")!;
  assert.deepEqual([resp.proof.type, resp.proof.message_id], ["message", "msg-1"]);
  const details = matrix.terms.flatMap((t) => Object.values(t.cells).map((c) => c.detail)).filter((d): d is string => !!d && d.length > 12);
  for (const d of details) assert.ok(!facts.some((f) => f.text.includes(d)), `term detail leaked: ${d}`);
});

test("facts: deterministic, and two quotes give a withheld fact with no rank", () => {
  const a = amara(), b = amara();
  assert.equal(
    JSON.stringify(buildRecommendationFacts(a.matrix, a.scores, { comparativeId: "x" })),
    JSON.stringify(buildRecommendationFacts(b.matrix, b.scores, { comparativeId: "x" })),
  );
  const two = amara({ vendors: ["bajrang", "shyama"] });
  const facts = buildRecommendationFacts(two.matrix, two.scores, { comparativeId: "x" });
  assert.ok(facts.some((f) => f.kind === "withheld"));
  assert.ok(facts.filter((f) => f.kind === "rank").every((f) => f.text.includes("withheld")));
  assert.equal(new Set(facts.filter((f) => f.kind === "rank").map((f) => f.vendor_id)).size, 2);
});
