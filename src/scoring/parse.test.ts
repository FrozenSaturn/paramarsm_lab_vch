import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAdvancePct, parseCompletionDays, parseDays, parsePaymentDays, parseWarrantyMonths } from "./parse";

test("parseDays: days, weeks, months, years, words", () => {
  assert.equal(parseDays("Within 14 days after getting the order"), 14); // Bajrang mobilisation
  assert.equal(parseDays("2 weeks from order"), 14);
  assert.equal(parseDays("3 months"), 90);
  assert.equal(parseDays("1 year"), 365);
  assert.equal(parseDays("within one week"), 7);
  assert.equal(parseDays("45 working days"), 45);
  assert.equal(parseDays("Immediately on receipt of order"), 0);
  assert.equal(parseDays("within a month"), 30);
  assert.equal(parseDays("extra month"), null, "'a' inside 'extra' is not read as one");
  assert.equal(parseDays("Monthly bills"), null);
  assert.equal(parseDays(null), null);
  assert.equal(parseDays("  "), null);
});

test("parseCompletionDays: single period and range", () => {
  assert.equal(parseCompletionDays("60 days from the date of work order"), 60);
  assert.equal(parseCompletionDays("60 to 75 days"), 75);
  assert.equal(parseCompletionDays("2-3 months"), 90);
  assert.equal(parseCompletionDays("As per site progress"), null);
  assert.equal(parseCompletionDays(null), null);
});

test("parseAdvancePct: percentages tied to advance or order only", () => {
  assert.equal(parseAdvancePct("25% payment along with the order"), 25); // Bajrang
  assert.equal(parseAdvancePct("50% material secured advance against supply of material at site"), 50); // Purvyakruti
  assert.equal(parseAdvancePct("25% with order; RA bills paid within 30 days; final within 30 days of bills"), 25);
  assert.equal(parseAdvancePct("10% mobilisation advance"), 10);
  assert.equal(parseAdvancePct("No advance"), 0);
  assert.equal(parseAdvancePct("Advance: Nil"), 0);
  assert.equal(parseAdvancePct("5% retention till handover"), null);
  assert.equal(parseAdvancePct("Monthly RA bills paid within 7 days; final bill within 15 days"), null);
  assert.equal(parseAdvancePct("Will be fixed after discussion"), null);
  assert.equal(parseAdvancePct(null), null);
});

test("parsePaymentDays: credit on running bills", () => {
  assert.equal(parsePaymentDays("25% with order; RA bills paid within 30 days; final within 30 days of bills"), 30); // Bajrang
  assert.equal(parsePaymentDays("Monthly RA bills paid within 7 days; final bill within 15 days"), 7); // Purvyakruti
  assert.equal(parsePaymentDays("Will be fixed after discussion"), null); // Shyama
  assert.equal(parsePaymentDays("100% advance with order"), 0);
  assert.equal(parsePaymentDays("Payment against order"), 0);
  assert.equal(parsePaymentDays("Final bill within 45 days"), 45);
  assert.equal(parsePaymentDays(null), null);
});

test("parseWarrantyMonths: years and months", () => {
  assert.equal(parseWarrantyMonths("10 years on non-judicial stamp paper"), 120); // Bajrang
  assert.equal(parseWarrantyMonths("18 months from completion"), 18);
  assert.equal(parseWarrantyMonths("Guarantee: five years"), 60);
  assert.equal(parseWarrantyMonths("No warranty"), 0);
  assert.equal(parseWarrantyMonths("As per standard"), null);
  assert.equal(parseWarrantyMonths(null), null);
});

test("every header string in fixtures/quotes.json parses as expected", () => {
  const fx = JSON.parse(readFileSync(new URL("../../fixtures/quotes.json", import.meta.url), "utf8")) as { quotes: { vendor_key: string; header: Record<string, string | null> }[] };
  const got = Object.fromEntries(fx.quotes.map((q) => [q.vendor_key, {
    advance: parseAdvancePct(q.header.advance) ?? parseAdvancePct(q.header.payment_terms),
    payment: parsePaymentDays(q.header.payment_terms),
    completion: parseCompletionDays(q.header.completion_time),
    mobilisation: parseDays(q.header.mobilisation),
    warranty: parseWarrantyMonths(q.header.warranty),
  }]));
  assert.deepEqual(got, {
    bajrang: { advance: 25, payment: 30, completion: null, mobilisation: 14, warranty: 120 },
    purvyakruti: { advance: 50, payment: 7, completion: null, mobilisation: null, warranty: null },
    shyama: { advance: null, payment: null, completion: null, mobilisation: null, warranty: null },
    sk: { advance: null, payment: null, completion: null, mobilisation: null, warranty: null },
  });
});
