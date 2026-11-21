import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionItem, collectIds, decisionItem, eventItem, mergeTimeline, parseAuditQuery, resolveWho, shortHash, stepItem,
  type Lookups,
} from "./audit-data";

const U1 = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";
const C1 = "44444444-4444-4444-8444-444444444444";

const l: Lookups = {
  emails: new Map([[U1, "hod@example.com"]]),
  vendors: new Map([[V1, "Shyama"], [V2, "Purvyakruti"]]),
  cases: new Map([[C1, "Amara Tower-2"]]),
};

test("resolveWho gives the email, the raw value or system", () => {
  assert.equal(resolveWho(U1, l.emails), "hod@example.com");
  assert.equal(resolveWho("w3", l.emails), "w3");
  assert.equal(resolveWho(null, l.emails), "system");
});

test("items resolve names and links", () => {
  const e = eventItem({ id: "e1", name: "quote.received", case_id: C1, payload: { vendor_id: V1 }, actor: U1, created_at: "2026-11-01T10:00:00Z" }, l);
  assert.equal(e.who, "hod@example.com");
  assert.deepEqual(e.links.map((x) => x.href), [`/cases/${C1}`, `/vendors/${V1}`]);
  assert.equal(e.case_title, "Amara Tower-2");

  const a = actionItem(
    { id: "a1", case_id: C1, kind: "send_email", status: "executed", payload: {}, proposed_by: null, approved_by: U1, edited_by: null,
      approved_at: "2026-11-02T10:00:00Z", reject_reason: null, error: null, created_at: "2026-11-02T09:00:00Z" },
    { action_id: "a1", payload_hash: "abcdef0123456789", approved_by: U1, approved_at: null, executed_at: "2026-11-02T10:01:00Z", provider_id: "msg-9" },
    l,
  );
  assert.equal(a.at, "2026-11-02T10:01:00Z");
  assert.equal(a.proof?.provider_id, "msg-9");
  assert.equal(shortHash(a.proof?.payload_hash), "abcdef0123");
});

test("override decision is marked and names both vendors", () => {
  const d = decisionItem(
    { id: "d1", recommendation_id: "r1", case_id: C1, vendor_id: V2, decided_by: U1, kind: "override", top_vendor_id: V1, reason: "Faster delivery", created_at: "2026-11-03T10:00:00Z" },
    undefined, l,
  );
  assert.equal(d.override, true);
  assert.match(d.what, /Purvyakruti instead of Shyama/);
  assert.equal(d.why, "Faster delivery");
  assert.ok(d.links.some((x) => x.href === `/vendors/${V1}`));
});

test("mergeTimeline sorts newest first, filters and limits", () => {
  const items = [
    eventItem({ id: "e1", name: "a", case_id: null, payload: null, actor: null, created_at: "2026-11-01T00:00:00Z" }, l),
    stepItem({ id: "s1", case_id: null, workflow: "w5", step: "read", status: "done", model: null, prompt_version: null, reasoning: "ok", cost_usd: null, started_at: "2026-11-03T00:00:00Z", finished_at: null }, l),
    decisionItem({ id: "d1", recommendation_id: null, vendor_id: V1, decided_by: U1, kind: "approve", reason: null, created_at: "2026-11-02T00:00:00Z" }, undefined, l),
  ];
  assert.deepEqual(mergeTimeline(items).map((i) => i.type), ["step", "decision", "event"]);
  assert.deepEqual(mergeTimeline(items, { type: "event" }).map((i) => i.id), ["event:e1"]);
  assert.deepEqual(mergeTimeline(items, { actor: "HOD@" }).map((i) => i.id), ["decision:d1"]);
  assert.equal(mergeTimeline(items, { limit: 1 }).length, 1);
});

test("collectIds keeps only uuid users and vendors", () => {
  const ids = collectIds({
    events: [{ id: "e", name: "x", case_id: C1, payload: { vendor_ids: [V1, "bad"] }, actor: "w3", created_at: null }],
    steps: [], actions: [],
    decisions: [{ id: "d", recommendation_id: null, vendor_id: V2, decided_by: U1, reason: null, created_at: null }],
    recs: [],
  });
  assert.deepEqual(ids.users, [U1]);
  assert.deepEqual(ids.vendors.sort(), [V1, V2].sort());
  assert.deepEqual(ids.cases, [C1]);
});

test("parseAuditQuery falls back to defaults", () => {
  assert.deepEqual(parseAuditQuery({ type: "bogus", case: "nope", actor: " hod " }), { caseId: undefined, type: "all", actor: "hod" });
  assert.equal(parseAuditQuery({ type: ["step"], case: C1 }).caseId, C1);
});
