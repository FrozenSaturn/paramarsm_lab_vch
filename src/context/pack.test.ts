import { test } from "node:test";
import assert from "node:assert/strict";
import { bound, byScoreDesc, clip, liveQuotes, mergeFacts, performanceFact, quoteFact } from "./pack";

const f = (id: string, text = `fact ${id}`) => ({ text, source_id: id, source_type: "fact" });

test("bound: drops empty and repeated items, keeps order, clips text", () => {
  const out = bound([f("a"), f("b", "  "), f("a", "again"), { text: "no id", source_id: "", source_type: "fact" }, f("c", "x".repeat(2000))], 10, 100);
  assert.deepEqual(out.map((i) => i.source_id), ["a", "c"]);
  assert.ok(out[1].text.length <= 100);
  assert.equal(bound([f("a"), f("b"), f("c")], 2).length, 2);
});

test("clip: word boundary and ellipsis", () => {
  assert.equal(clip("short text", 50), "short text");
  const c = clip("one two three four five six seven", 15);
  assert.ok(c.endsWith("…") && c.length <= 15, c);
});

test("mergeFacts: a long group cannot push out short groups", () => {
  const boq = Array.from({ length: 50 }, (_, i) => f(`boq${i}`));
  const out = mergeFacts([[f("case")], [f("q1"), f("q2")], boq, [f("perf")]], 12, 4);
  const ids = out.map((i) => i.source_id);
  assert.equal(out.length, 12);
  assert.deepEqual(ids.slice(0, 4), ["case", "q1", "q2", "boq0"]);
  assert.ok(ids.includes("perf"), "the performance record survives the bound");
});

test("byScoreDesc is stable", () => {
  const out = byScoreDesc([{ id: 1, score: 1 }, { id: 2, score: 3 }, { id: 3, score: 1 }, { id: 4 }]);
  assert.deepEqual(out.map((x) => x.id), [2, 1, 3, 4]);
});

test("liveQuotes: latest version per vendor, no failed or superseded", () => {
  const out = liveQuotes([
    { id: "a1", vendor_id: "A", version: 1, status: "superseded" },
    { id: "a2", vendor_id: "A", version: 2, status: "ready" },
    { id: "b1", vendor_id: "B", version: 1, status: "failed" },
    { id: "c1", vendor_id: "C", version: 1, status: "needs_review" },
  ]);
  assert.deepEqual(out.map((q) => q.id).sort(), ["a2", "c1"]);
});

test("fact text: quote and performance", () => {
  const q = quoteFact({ version: 1, status: "ready", total_on_boq: "1376412.01", comparable_lines: 6, scope: "different", quote_date: "2026-05-21",
    valid_until: null, payment_terms: null, completion_time: null, flags: [{ code: "stale", severity: "warn" }, { code: "totals_agree", severity: "info" }] }, "Bajrang");
  assert.match(q, /Bajrang/);
  assert.match(q, /13,76,412/);
  assert.match(q, /flags: stale\./);
  assert.doesNotMatch(q, /totals_agree/);
  const p = performanceFact({ quality: null, timeliness: 2, disputes: null, safety: null, note: "9 days late", source: "confirmed", is_demo: false }, "Bajrang");
  assert.equal(p, "Past performance of Bajrang (confirmed by a person): timeliness 2/5. 9 days late.");
});
