import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatrix, inputsHash } from "./matrix";
import { compareInputFromFixtures, fixtureVendorId as vid } from "./fixtures";
import { decideOnDueDate, decideOnQuote } from "./triggers";
import { scoreComparative } from "@/scoring";
import { DEFAULT_WEIGHTS } from "@/scoring/types";

const NO_EXTRA = { performance: {}, reminders: {}, required_days: null };

test("fixtures -> matrix -> scores: SK is lowest on price, Bajrang's missing line is loaded", () => {
  const input = compareInputFromFixtures();
  const m = buildMatrix(input);
  const r = scoreComparative(m, input, NO_EXTRA, DEFAULT_WEIGHTS);
  assert.equal(m.lowest_landed_vendor_id, vid("sk"));
  const sk = r.scores.find((s) => s.vendor_id === vid("sk"))!;
  const bajrang = r.scores.find((s) => s.vendor_id === vid("bajrang"))!;
  assert.equal(sk.params.find((p) => p.param === "price")!.score, 100);
  assert.ok(bajrang.params.find((p) => p.param === "price")!.score < 100);
  assert.ok(bajrang.risk_flags.some((f) => f.code === "lines_missing"));
  assert.ok(sk.risk_flags.some((f) => f.code === "unconfirmed_handwriting" && f.severity === "block"));
  assert.deepEqual(r.scores.map((s) => s.rank).sort(), [1, 2, 3, 4]);
});

test("pipeline is deterministic: same input and weights give byte-identical JSON and hash", () => {
  const run = () => {
    const input = compareInputFromFixtures();
    const m = buildMatrix(input);
    return { json: JSON.stringify({ m, s: scoreComparative(m, input, NO_EXTRA, DEFAULT_WEIGHTS).scores }), hash: inputsHash(input, DEFAULT_WEIGHTS, NO_EXTRA) };
  };
  const a = run(), b = run();
  assert.equal(a.json, b.json);
  assert.equal(a.hash, b.hash);
});

test("the extras change the hash; leaving them out keeps the old hash", () => {
  const input = compareInputFromFixtures();
  const base = inputsHash(input, DEFAULT_WEIGHTS);
  assert.equal(base, inputsHash(input, DEFAULT_WEIGHTS, undefined));
  assert.notEqual(inputsHash(input, DEFAULT_WEIGHTS, NO_EXTRA), inputsHash(input, DEFAULT_WEIGHTS, { ...NO_EXTRA, reminders: { [vid("sk")]: 1 } }));
});

test("three quotes rank; two quotes withhold the ranking", () => {
  const input = compareInputFromFixtures({ vendors: ["bajrang", "shyama"] });
  const m = buildMatrix(input);
  const r = scoreComparative(m, input, NO_EXTRA, DEFAULT_WEIGHTS);
  assert.equal(m.ranking_withheld, true);
  assert.ok(r.scores.every((s) => s.rank === null));
});

test("W6 trigger: all invited vendors quoted -> all_quoted; one missing -> wait", () => {
  const all = decideOnQuote({ invitedVendorIds: ["a", "b", "c"], liveVendorIds: ["c", "b", "a"], quoteVersion: 1, hasComparative: false });
  assert.deepEqual(all.run && all.trigger, "all_quoted");
  const wait = decideOnQuote({ invitedVendorIds: ["a", "b", "c"], liveVendorIds: ["a"], quoteVersion: 1, hasComparative: false });
  assert.equal(wait.run, false);
  assert.equal(!wait.run && wait.waitingFor, 2);
  assert.match(wait.reason, /Waiting for 2 more quotes/);
});

test("W6 trigger: a revised quote re-runs only when a comparative exists", () => {
  const rev = decideOnQuote({ invitedVendorIds: ["a", "b", "c"], liveVendorIds: ["a"], quoteVersion: 2, hasComparative: true });
  assert.equal(rev.run && rev.trigger, "revised_quote");
  const first = decideOnQuote({ invitedVendorIds: ["a", "b", "c"], liveVendorIds: ["a"], quoteVersion: 2, hasComparative: false });
  assert.equal(first.run, false);
  const none = decideOnQuote({ invitedVendorIds: [], liveVendorIds: ["a"], quoteVersion: 1, hasComparative: false });
  assert.equal(none.run, false);
});

test("W6 trigger: due date with three or more compares; fewer raises an alert", () => {
  const ok = decideOnDueDate(3);
  assert.equal(ok.run && ok.trigger, "due_date");
  const few = decideOnDueDate(2);
  assert.equal(few.run, false);
  assert.equal(!few.run && few.alert, true);
});
