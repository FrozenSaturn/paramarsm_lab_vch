import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionDbMessage, validateDecision, type DecisionContext } from "./decide-rules";
import { DEFAULT_WEIGHTS } from "@/scoring/types";

const ctx: DecisionContext = { status: "with_hod", topVendorId: "top", vendorIds: ["top", "v2", "v3"] };
const rec = "rec-1";

test("approve: the vendor is the top vendor", () => {
  const r = validateDecision({ recommendationId: rec, kind: "approve" }, ctx);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && [r.row.vendor_id, r.row.overridden], ["top", false]);
  const other = validateDecision({ recommendationId: rec, kind: "approve", vendorId: "v2" }, ctx);
  assert.ok(!other.ok && /use override/.test(other.error));
});

test("override: needs a non-top vendor in the comparative and a reason of 5 or more characters", () => {
  assert.ok(!validateDecision({ recommendationId: rec, kind: "override", vendorId: "v2" }, ctx).ok);
  const short = validateDecision({ recommendationId: rec, kind: "override", vendorId: "v2", reason: "  ok  " }, ctx);
  assert.ok(!short.ok && /reason is required/.test(short.error));
  assert.ok(!validateDecision({ recommendationId: rec, kind: "override", vendorId: "top", reason: "better price" }, ctx).ok);
  assert.ok(!validateDecision({ recommendationId: rec, kind: "override", vendorId: "nope", reason: "better price" }, ctx).ok);
  assert.ok(!validateDecision({ recommendationId: rec, kind: "override", reason: "better price" }, ctx).ok);
  const ok = validateDecision({ recommendationId: rec, kind: "override", vendorId: "v2", reason: "  Did good work at Amara Tower-1  ", weights: DEFAULT_WEIGHTS }, ctx);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.row, { kind: "override", vendor_id: "v2", overridden: true, reason: "Did good work at Amara Tower-1", weights: DEFAULT_WEIGHTS });
});

test("send_back: needs a reason and no vendor", () => {
  assert.ok(!validateDecision({ recommendationId: rec, kind: "send_back" }, ctx).ok);
  assert.ok(!validateDecision({ recommendationId: rec, kind: "send_back", vendorId: "v2", reason: "check scope" }, ctx).ok);
  const ok = validateDecision({ recommendationId: rec, kind: "send_back", reason: "Get a fourth quote" }, ctx);
  assert.deepEqual(ok.ok && [ok.row.vendor_id, ok.row.overridden], [null, false]);
});

test("status must be with_hod; bad weights and unknown kinds are refused", () => {
  for (const status of ["draft", "decided", "sent_back", "superseded"]) {
    assert.ok(!validateDecision({ recommendationId: rec, kind: "approve" }, { ...ctx, status }).ok, status);
  }
  const w = validateDecision({ recommendationId: rec, kind: "approve", weights: { ...DEFAULT_WEIGHTS, price: 90 } }, ctx);
  assert.ok(!w.ok && /weights are not valid/.test(w.error));
  assert.ok(!validateDecision({ recommendationId: rec, kind: "pick" as any }, ctx).ok);
  assert.ok(!validateDecision({ recommendationId: rec, kind: "approve" }, { ...ctx, topVendorId: null }).ok);
});

test("database errors map to clear messages", () => {
  assert.equal(decisionDbMessage({ code: "P0001", message: "only a HOD can record a decision" }), "Only a HOD can record a decision.");
  assert.match(decisionDbMessage({ code: "23505", message: "duplicate key value violates unique constraint \"decisions_one_per_recommendation\"" }), /already has a decision/);
  assert.match(decisionDbMessage({ code: "23514", message: "new row violates check constraint \"decisions_reason_chk\"" }), /reason of at least 5/);
});
