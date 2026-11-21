import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatrix, inputsHash, LOAD_MISSING_LINES } from "./matrix";
import { compareInputFromFixtures, fixtureVendorId as vid } from "./fixtures";
import type { CompareInput, CompareQuote } from "./types";
import { DEFAULT_WEIGHTS } from "@/scoring/types";
import { round } from "@/quotes/units";

const BAJRANG = vid("bajrang"), PURVY = vid("purvyakruti"), SHYAMA = vid("shyama"), SK = vid("sk");

test("before GST on Vinayak's quantities equals the hand-checked numbers", () => {
  const m = buildMatrix(compareInputFromFixtures());
  assert.equal(m.totals[BAJRANG].before_gst, 1376412.01);
  assert.equal(m.totals[PURVY].before_gst, 1898612.0);
  assert.equal(m.totals[SHYAMA].before_gst, 1704240.8);
  assert.equal(m.totals[SK].before_gst, 1381464.0);
  assert.equal(m.totals[BAJRANG].lines_priced, 6);
  assert.deepEqual(m.totals[PURVY].lines_missing, []);
});

test("vendors are ordered by name and every row has a cell for every vendor", () => {
  const m = buildMatrix(compareInputFromFixtures());
  assert.deepEqual(m.vendors.map((v) => v.vendor_id), [BAJRANG, PURVY, SK, SHYAMA]);
  assert.deepEqual(m.rows.map((r) => r.serial), ["1", "2", "3", "4", "5", "6", "7"]);
  for (const r of m.rows) assert.deepEqual(Object.keys(r.cells).sort(), [BAJRANG, PURVY, SHYAMA, SK].sort());
  assert.equal(m.as_of, "2026-11-23");
  assert.equal(m.rows[0].boq_line_id, "boq-line-1"); // matched by serial: fixture lines carry no boq_line_id
});

test("every amount is rate × quantity and every total is the sum of the amounts shown", () => {
  const m = buildMatrix(compareInputFromFixtures());
  for (const v of m.vendors) {
    let sum = 0;
    for (const r of m.rows) {
      const c = r.cells[v.vendor_id];
      if (c.amount == null) continue;
      assert.equal(c.amount, round(c.rate! * r.quantity!, 2), `${v.name} line ${r.serial}`);
      sum += c.amount;
    }
    const t = m.totals[v.vendor_id];
    assert.equal(t.before_gst, round(sum, 2));
    assert.equal(t.gst, round(t.before_gst * t.gst_rate, 2));
    assert.equal(t.landed, round(t.before_gst + t.gst, 2));
    assert.equal(t.landed_for_price, round((t.before_gst + t.loading) * (1 + t.gst_rate), 2));
  }
});

test("Bajrang line 3 is not comparable and is loaded at the highest other amount", () => {
  const m = buildMatrix(compareInputFromFixtures());
  const row = m.rows.find((r) => r.serial === "3")!;
  const c = row.cells[BAJRANG];
  assert.equal(c.missing, true);
  assert.equal(c.rate, null);
  assert.equal(c.amount, null);
  assert.equal(c.rate_raw, 34.5);
  assert.equal(c.unit_raw, "SQM.");
  assert.equal(c.lowest, false);
  assert.ok(c.flags.some((f) => f.code === "not_comparable"));
  const others = [PURVY, SHYAMA, SK].map((v) => row.cells[v].amount!);
  assert.equal(c.loaded_amount, Math.max(...others));
  assert.equal(c.loaded_amount, 43500); // Shyama: 87 × 500 RMT
  const t = m.totals[BAJRANG];
  assert.deepEqual(t.lines_missing, ["3"]);
  assert.equal(t.loading, 43500);
  assert.equal(t.landed, 1624166.17); // what Bajrang priced, nothing added
  assert.equal(t.landed_for_price, round((1376412.01 + 43500) * 1.18, 2));
  // With the load, Bajrang does not win on price by leaving a line out.
  assert.equal(m.lowest_landed_vendor_id, SK);
  assert.ok(m.notes.some((n) => /Bajrang.*line 3.*₹43,500\.00/.test(n)));
});

test("loading can be switched off", () => {
  assert.equal(LOAD_MISSING_LINES, true);
  const m = buildMatrix(compareInputFromFixtures(), { loadMissing: false });
  const t = m.totals[BAJRANG];
  assert.equal(t.loading, 0);
  assert.equal(t.landed_for_price, t.landed);
  assert.equal(m.rows[2].cells[BAJRANG].loaded_amount, null);
  assert.equal(m.lowest_landed_vendor_id, BAJRANG);
});

test("lowest per row: S.K. on the area lines, Purvyakruti on the depression line", () => {
  const m = buildMatrix(compareInputFromFixtures());
  for (const r of m.rows) {
    const priced = m.vendors.filter((v) => r.cells[v.vendor_id].amount != null);
    const min = Math.min(...priced.map((v) => r.cells[v.vendor_id].amount!));
    const want = priced.filter((v) => r.cells[v.vendor_id].amount === min).map((v) => v.vendor_id);
    assert.deepEqual(r.lowest_vendor_ids, want, `line ${r.serial}`);
    for (const v of m.vendors) assert.equal(r.cells[v.vendor_id].lowest, want.includes(v.vendor_id));
  }
  assert.deepEqual(m.rows[0].lowest_vendor_ids, [SK]);
  assert.deepEqual(m.rows[2].lowest_vendor_ids, [PURVY]);
});

test("ties on a row are all lowest", () => {
  const input = compareInputFromFixtures();
  const sk = input.quotes.find((q) => q.vendor_id === SK)!;
  const by = input.quotes.find((q) => q.vendor_id === BAJRANG)!;
  const l1 = by.lines.find((l) => l.serial === "1")!;
  const s1 = sk.lines.find((l) => l.serial === "1")!;
  Object.assign(l1, { rate: s1.rate, normalized_rate: s1.normalized_rate });
  assert.deepEqual(buildMatrix(input).rows[0].lowest_vendor_ids, [BAJRANG, SK]);
});

/** A one-line quote for GST and count tests. */
function synth(vendor: string, gst: CompareQuote["gst_treatment"], gstRate: number | null, rate: number): CompareQuote {
  return {
    quote_id: `q-${vendor}`, vendor_id: vendor, vendor_name: vendor, version: 1, status: "ready", document_id: null,
    quote_date: "2026-11-18", received_at: "2026-11-18T10:00:00Z", scope: "matches", gst_treatment: gst, gst_rate: gstRate,
    validity_days: null, valid_until: null, payment_terms: null, advance: null, completion_time: null, mobilisation: null, warranty: null,
    needs_review: false, flags: [], terms: [],
    lines: [{
      id: `l-${vendor}`, boq_line_id: "b1", boq_serial: "1", serial: "1", item: "x", unit_raw: "SQM", quantity: 100, rate,
      normalized_rate: rate, normalized_unit: "SQM", make: null, page: 1, rate_handwritten: false, rate_confirmed: false, flags: [],
    }],
  };
}
const synthInput = (quotes: CompareQuote[]): CompareInput => ({
  case_id: "c", rfq_id: "r", boq_version_id: null, rfq_sent_at: "2026-11-16T10:00:00Z", rfq_due_date: null,
  boq: [{ id: "b1", serial: "1", description: "Floor", unit: "SQM", quantity: 100 }],
  quotes,
});

test("GST: extra adds the stated rate, inclusive takes it out, not stated adds 18%", () => {
  const m = buildMatrix(synthInput([
    synth("a-extra", "extra", 0.12, 100),
    synth("b-incl", "inclusive", 0.18, 118),
    synth("c-none", "not_stated", null, 100),
    synth("d-pct", "extra", 18, 100), // the database stores a percent
  ]));
  const a = m.totals["a-extra"], b = m.totals["b-incl"], c = m.totals["c-none"], d = m.totals["d-pct"];
  assert.deepEqual([a.gst_basis, a.gst_rate, a.before_gst, a.gst, a.landed], ["extra", 0.12, 10000, 1200, 11200]);
  assert.deepEqual([b.gst_basis, b.gst_rate, b.before_gst, b.gst, b.landed], ["inclusive", 0.18, 10000, 1800, 11800]);
  assert.deepEqual([c.gst_basis, c.gst_rate, c.before_gst, c.gst, c.landed], ["assumed_standard", 0.18, 10000, 1800, 11800]);
  assert.equal(d.gst_rate, 0.18);
  // Compared before GST, the inclusive vendor ties with the others on the row.
  assert.deepEqual(m.rows[0].lowest_vendor_ids, ["a-extra", "b-incl", "c-none", "d-pct"]);
  assert.equal(m.lowest_landed_vendor_id, "a-extra");
  assert.ok(m.notes.some((n) => /b-incl quotes rates that include GST/.test(n)));
  assert.ok(m.notes.some((n) => /c-none does not state GST/.test(n)));
});

test("same input gives the same JSON; the hash is stable and follows the rates", () => {
  const a = buildMatrix(compareInputFromFixtures());
  const b = buildMatrix(compareInputFromFixtures());
  assert.equal(JSON.stringify(a), JSON.stringify(b));

  const input = compareInputFromFixtures();
  const h = inputsHash(input, DEFAULT_WEIGHTS);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(inputsHash(compareInputFromFixtures(), { ...DEFAULT_WEIGHTS }), h);
  // Key order and quote order do not change the hash.
  const reordered = { ...input, quotes: [...input.quotes].reverse() };
  assert.equal(inputsHash(reordered, Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).reverse())), h);
  // A rate or a weight does.
  const changed = compareInputFromFixtures();
  changed.quotes[0].lines[0].rate = 35;
  assert.notEqual(inputsHash(changed, DEFAULT_WEIGHTS), h);
  assert.notEqual(inputsHash(input, { ...DEFAULT_WEIGHTS, price: 41 }), h);
});

test("fewer than three quotes: ranking withheld and a note says why", () => {
  const m = buildMatrix(compareInputFromFixtures({ vendors: ["purvyakruti", "shyama"] }));
  assert.equal(m.ranking_withheld, true);
  assert.match(m.notes[0], /Fewer than 3 quotes \(2\)/);
  assert.equal(buildMatrix(compareInputFromFixtures()).ranking_withheld, false);
});

test("a line not quoted at all is missing and loaded", () => {
  const input = compareInputFromFixtures({ vendors: ["purvyakruti", "shyama", "sk"] });
  const sh = input.quotes.find((q) => q.vendor_id === SHYAMA)!;
  sh.lines = sh.lines.filter((l) => l.serial !== "4");
  const m = buildMatrix(input);
  const c = m.rows[3].cells[SHYAMA];
  assert.equal(c.missing, true);
  assert.equal(c.quote_line_id, null);
  assert.ok(c.flags.some((f) => f.code === "not_quoted"));
  assert.equal(c.loaded_amount, m.rows[3].cells[PURVY].amount); // Purvyakruti is the highest of the others
  assert.equal(m.totals[SHYAMA].loading, c.loaded_amount);
});

test("terms grid has the six terms with their labels; S.K. needs review", () => {
  const m = buildMatrix(compareInputFromFixtures());
  assert.deepEqual(m.terms.map((t) => t.label), ["PF & ESI", "TDS", "Security deposit", "GST extra", "Site facilities", "Safety PPE"]);
  assert.equal(m.terms[3].cells[PURVY].status, "met");
  assert.equal(m.terms[4].cells[BAJRANG].status, "not_met");
  assert.equal(m.terms[0].cells[SK].status, "not_stated");
  const sk = m.vendors.find((v) => v.vendor_id === SK)!;
  assert.equal(sk.status, "needs_review");
  assert.ok(sk.flags.some((f) => f.code === "handwriting"));
  assert.ok(m.rows.every((r) => r.cells[SK].handwritten && !r.cells[SK].confirmed));
  assert.ok(m.notes.some((n) => /S\.K\. Construction has 7 handwritten rates/.test(n)));
  const confirmed = buildMatrix(compareInputFromFixtures({ skConfirmed: true }));
  assert.equal(confirmed.vendors.find((v) => v.vendor_id === SK)!.status, "ready");
  assert.ok(confirmed.rows.every((r) => r.cells[SK].confirmed));
});
