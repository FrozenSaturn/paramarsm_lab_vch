import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRating, validatePerformance } from "./performance-payload";
import { payloadFromReading } from "./performance-from-memory";

const V = "9baa9c2b-301b-4fe3-b295-ba1e0670f75c";
const M = "59845484-6dac-4a99-a617-6590cd9a04a1";

test("parseRating", () => {
  assert.equal(parseRating(3), 3);
  assert.equal(parseRating("4"), 4);
  assert.equal(parseRating(null), null);
  assert.equal(parseRating(""), null);
  assert.equal(parseRating(0), "invalid");
  assert.equal(parseRating(6), "invalid");
  assert.equal(parseRating(2.5), "invalid");
});

test("validatePerformance: ids from the proposal, ratings from the edit", () => {
  const original = { vendor_id: V, timeliness: 2, note: "late", message_id: M, source_memory_id: "ref-1" };
  const edited = { vendor_id: V, timeliness: 3, quality: 4, note: "  late, but good work  " };
  const r = validatePerformance(original, edited);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.row, { vendor_id: V, quality: 4, timeliness: 3, disputes: null, safety: null, note: "late, but good work", source_message_id: M, source_memory_id: "ref-1" });
  }
});

test("validatePerformance: errors", () => {
  const bad = (o: any, e: any) => { const r = validatePerformance(o, e); assert.equal(r.ok, false); return r.ok ? [] : r.errors; };
  assert.match(bad({ vendor_id: "x" }, { timeliness: 2 }).join(), /uuid/);
  assert.match(bad({ vendor_id: V }, { vendor_id: "9baa9c2b-301b-4fe3-b295-000000000000", timeliness: 2 }).join(), /cannot be changed/);
  assert.match(bad({ vendor_id: V }, { timeliness: 7 }).join(), /1 to 5/);
  assert.match(bad({ vendor_id: V }, { note: "x" }).join(), /at least one rating/);
});

test("payloadFromReading: only a named candidate, at least one valid rating", () => {
  const cands = [{ id: V, name: "Bajrang" }];
  const base = { reports_performance: true, vendor_id: V, quality: null, timeliness: 2, disputes: null, safety: 9, note: "9 days late", evidence: "Bajrang was 9 days late" };
  const ok = payloadFromReading(base, cands, { messageId: M, memoryRefId: "ref-1" });
  assert.ok("payload" in ok);
  if ("payload" in ok) {
    assert.equal(ok.payload.timeliness, 2);
    assert.equal(ok.payload.safety, null, "an out-of-range rating is dropped");
    assert.equal(ok.payload.message_id, M);
  }
  assert.ok("reason" in payloadFromReading({ ...base, reports_performance: false }, cands, {}));
  assert.ok("reason" in payloadFromReading({ ...base, vendor_id: "someone-else" }, cands, {}));
  assert.ok("reason" in payloadFromReading({ ...base, timeliness: null, safety: null }, cands, {}));
});
