import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseQuote, type BoqLineIn } from "./normalise";
import { fixtureBoq, fixtureExtraction, fixtureRfqSentAt, fixtureSecondRead } from "./fixture-quotes";
import { convertRate, parseUnit, SQFT_PER_SQM } from "./units";
import { parseDate, parseValidityDays, fmtINR } from "./format";
import { termsFromRfq } from "./terms";

const opts = { boq: fixtureBoq, rfqSentAt: fixtureRfqSentAt };
const codes = (flags: { code: string }[]) => flags.map((f) => f.code);
const line = (n: ReturnType<typeof normaliseQuote>, serial: string) => n.lines.find((l) => l.serial === serial)!;

test("units: spellings from the quotes, OCR slips, conversion", () => {
  assert.equal(parseUnit("SOFT").code, "SQFT"); // SK scan OCR
  assert.equal(parseUnit("SQM.").code, "SQM"); // Bajrang line 3
  assert.equal(parseUnit("Sq. Ft").code, "SQFT");
  assert.equal(parseUnit("R.M.T").dim, "length");
  assert.equal(parseUnit("bags").dim, "unknown");
  assert.ok(Math.abs(convertRate(34.5, parseUnit("SQFT"), parseUnit("SQM"))! - 34.5 * SQFT_PER_SQM) < 1e-9);
  assert.equal(convertRate(34.5, parseUnit("SQM"), parseUnit("RMT")), null);
});

test("dates and money as Indian quotes print them", () => {
  assert.equal(parseDate("21.05.2026"), "2026-05-21");
  assert.equal(parseDate("20/5/26"), "2026-05-20");
  assert.equal(parseDate("31.02.2026"), null);
  assert.equal(parseValidityDays("Validity of our offer: 45 days from the date of our Quotation"), 45);
  assert.equal(fmtINR(1197949.63), "₹11,97,949.63");
});

test("Purvyakruti priced Vinayak's quantities; its totals agree; not stale", () => {
  const n = normaliseQuote(fixtureExtraction("purvyakruti"), opts);
  assert.equal(n.scope, "matches");
  assert.ok(codes(n.flags).includes("scope_matches"));
  assert.ok(codes(n.flags).includes("totals_agree"));
  assert.ok(!codes(n.flags).includes("stale"));
  assert.equal(n.total_on_boq, 1898612.0);
  assert.equal(n.vendor_total, 1898612.0);
  assert.equal(n.comparable_lines, 7);
  assert.equal(n.needs_review, false);
  // shown per square metre: 47 per sq ft = 505.90 per sq m
  assert.equal(line(n, "1").normalized_unit, "SQM");
  assert.ok(Math.abs(line(n, "1").normalized_rate! - 505.9038) < 0.001);
});

test("Purvyakruti against the site sheet's square-metre BOQ is flagged close, not different", () => {
  // Site sheet: toilet floor 1247.63375 SQM (= 13,424.54 SQFT at the sheet's 10.76).
  const siteBoq: BoqLineIn[] = [{ id: null, serial: "1", description: "WATERPROOFING AT TOILET FLOOR", unit: "SQM", quantity: 1247.63375 }];
  const x = fixtureExtraction("purvyakruti");
  x.lines = x.lines.filter((l) => l.serial === "1");
  const n = normaliseQuote(x, { boq: siteBoq, rfqSentAt: fixtureRfqSentAt });
  assert.ok(codes(line(n, "1").flags).includes("qty_close"));
  assert.equal(n.scope, "close");
  // the comparison is on Vinayak's quantity in sq m: 47/sqft × 10.7639 × 1247.63375
  assert.ok(Math.abs(line(n, "1").amount_on_boq! - 47 * SQFT_PER_SQM * 1247.63375) < 0.01);
});

test("Bajrang: stale, lapsed, different scope, and the depression line cannot be compared", () => {
  const n = normaliseQuote(fixtureExtraction("bajrang"), opts);
  const c = codes(n.flags);
  assert.ok(c.includes("stale"));
  assert.match(n.flags.find((f) => f.code === "stale")!.message, /179 days before/);
  assert.ok(c.includes("validity_expired"));
  assert.equal(n.valid_until, "2026-07-05");
  assert.equal(n.scope, "different");
  assert.ok(c.includes("different_scope"));
  assert.ok(codes(line(n, "3").flags).includes("unit_mismatch"));
  assert.equal(line(n, "3").amount_on_boq, null);
  assert.equal(n.comparable_lines, 6);
  // 34.50 × 39,896 sq ft = 13,76,412.00; each line is rounded to paise first, as a CS prints it, so the sum is 0.01 more
  assert.equal(n.total_on_boq, 1376412.01);
  assert.equal(n.gst.treatment, "extra");
  assert.equal(n.gst.rate, 18);
  assert.equal(n.needs_review, false);
});

test("Shyama: undated, different scope, printed total agrees with lines", () => {
  const n = normaliseQuote(fixtureExtraction("shyama"), opts);
  const c = codes(n.flags);
  assert.ok(c.includes("undated"));
  assert.ok(!c.includes("stale"));
  assert.ok(c.includes("different_scope"));
  assert.ok(c.includes("totals_agree"));
  assert.equal(n.stated_grand_total, 4280510);
  assert.equal(n.total_on_boq, 1704240.8);
});

test("SK: handwritten rates always go to review; two reads that agree are noted", () => {
  const n = normaliseQuote(fixtureExtraction("sk"), { ...opts, secondRead: fixtureSecondRead("sk") });
  assert.ok(codes(n.flags).includes("stale"));
  assert.ok(codes(n.flags).includes("handwriting"));
  assert.ok(n.lines.every((l) => codes(l.flags).includes("handwritten")));
  assert.equal(n.needs_review, true);
  assert.equal(n.total_on_boq, 1381464.0); // 34 × 39,896 + 50 × 500
});

test("SK: two reads that disagree, or no second read, block the line", () => {
  const disagree = normaliseQuote(fixtureExtraction("sk"), { ...opts, secondRead: fixtureSecondRead("sk", { "3": 58 }) });
  const l3 = line(disagree, "3");
  assert.ok(codes(l3.flags).includes("reads_disagree"));
  assert.match(l3.flags.find((f) => f.code === "reads_disagree")!.message, /50 and 58/);
  const none = normaliseQuote(fixtureExtraction("sk"), opts);
  assert.ok(none.lines.every((l) => codes(l.flags).includes("reads_disagree")));
});

test("a rate only the second read calls handwritten still goes to review", () => {
  const x = fixtureExtraction("sk");
  x.lines.forEach((l) => (l.rate_handwritten = false)); // first read missed the pen
  const n = normaliseQuote(x, { ...opts, secondRead: fixtureSecondRead("sk") });
  assert.ok(n.lines.every((l) => l.rate_handwritten && codes(l.flags).includes("handwritten")));
  assert.equal(n.needs_review, true);
});

test("once a person confirms every handwritten rate, the quote leaves review", () => {
  const confirmed = new Set(["1", "2", "3", "4", "5", "6"].map((s) => `line:${s}:rate`));
  const partly = normaliseQuote(fixtureExtraction("sk"), { ...opts, secondRead: fixtureSecondRead("sk", { "3": 58 }), confirmed });
  assert.equal(partly.needs_review, true); // line 7 still unconfirmed
  assert.deepEqual(partly.review_reasons.map((r) => r.split(":")[0]), ["Line 7"]);
  confirmed.add("line:7:rate");
  const done = normaliseQuote(fixtureExtraction("sk"), { ...opts, secondRead: fixtureSecondRead("sk", { "3": 58 }), confirmed });
  assert.equal(done.needs_review, false);
  assert.ok(done.lines.every((l) => codes(l.flags).includes("confirmed")));
});

test("vendor arithmetic is recomputed and differences flagged", () => {
  const x = fixtureExtraction("shyama");
  x.lines[0].amount = 1277000; // printed amount off by 640
  const n = normaliseQuote(x, opts);
  const f = line(n, "1").flags.find((f) => f.code === "arithmetic");
  assert.ok(f);
  assert.match(f!.message, /₹640\.00/);
  assert.ok(!codes(n.flags).includes("total_mismatch")); // the printed total still matches quantity × rate
  assert.equal(n.needs_review, true);

  // Confirmed rate: the difference is the vendor's arithmetic, still shown, no longer a review item.
  const c = normaliseQuote(x, { ...opts, confirmed: new Set(["line:1:rate"]) });
  assert.deepEqual(codes(line(c, "1").flags).filter((k) => k.includes("arithmetic")), ["vendor_arithmetic"]);
  assert.equal(c.needs_review, false);

  const y = fixtureExtraction("shyama");
  y.stated_totals[0].amount = 4208510; // digits transposed in the printed total
  const m = normaliseQuote(y, opts);
  assert.match(m.flags.find((f) => f.code === "total_mismatch")!.message, /by ₹72,000\.00/);
});

test("RFQ terms are read from A's { id, text } shape, from plain strings, or fall back to the defaults", () => {
  const a = termsFromRfq([{ id: "security_deposit", text: "10% retention" }, { id: "not_a_term", text: "x" }]);
  assert.equal(a.security_deposit.text, "10% retention");
  assert.match(a.pf_esi.text, /PF & ESI/);
  assert.equal(termsFromRfq(["PF only", "TDS only"]).tds.text, "TDS only");
  assert.match(termsFromRfq({ source: "made-up" }).gst_extra.text, /GST/);
});

test("all six RFQ terms are always present, in order", () => {
  const x = fixtureExtraction("purvyakruti");
  x.terms = x.terms.slice(0, 2);
  const n = normaliseQuote(x, opts);
  assert.deepEqual(n.terms.map((t) => t.term), ["pf_esi", "tds", "security_deposit", "gst_extra", "site_facilities", "safety_ppe"]);
  assert.equal(n.terms[5].status, "not_stated");
});

test("same reading gives the same result every time", () => {
  for (const v of ["bajrang", "purvyakruti", "shyama", "sk"] as const) {
    const a = normaliseQuote(fixtureExtraction(v), { ...opts, secondRead: v === "sk" ? fixtureSecondRead("sk") : null });
    const b = normaliseQuote(fixtureExtraction(v), { ...opts, secondRead: v === "sk" ? fixtureSecondRead("sk") : null });
    assert.deepEqual(a, b);
  }
});
