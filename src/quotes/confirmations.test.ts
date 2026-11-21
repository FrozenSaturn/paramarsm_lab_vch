import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConfirmations, originalValue, parseConfirmKey, type Confirmations } from "./confirmations";
import { fixtureExtraction } from "./fixture-quotes";

const by = { by: "u1", at: "2026-11-21T10:00:00Z", original: null };

test("only real fields of this reading can be confirmed", () => {
  const x = fixtureExtraction("sk");
  assert.equal(parseConfirmKey("line:3:rate", x), "line:3:rate");
  assert.equal(parseConfirmKey("header:quote_date", x), "header:quote_date");
  for (const bad of ["header:__proto__", "header:constructor", "header:toString", "line:99:rate", "line:3:amount", "line:3:rate:x", "extraction", ""]) {
    assert.equal(parseConfirmKey(bad, x), null, bad);
  }
});

test("a stored confirmation for __proto__ cannot touch Object.prototype", () => {
  const x = fixtureExtraction("sk");
  const conf = JSON.parse('{"header:__proto__": {"value": "polluted", "by": "u1", "at": "", "original": null}}') as Confirmations;
  applyConfirmations(x, conf);
  assert.equal(({} as any).value, undefined);
  assert.equal(({} as any).confidence, undefined);
  assert.equal(originalValue(x, "header:__proto__"), null);
});

test("confirmed values are laid over the reading without changing it", () => {
  const x = fixtureExtraction("sk");
  const out = applyConfirmations(x, { "line:3:rate": { ...by, value: 58 }, "header:quote_date": { ...by, value: "2026-05-20" } });
  assert.equal(out.lines.find((l) => l.serial === "3")!.rate, 58);
  assert.equal(out.header.quote_date.value, "2026-05-20");
  assert.equal(x.lines.find((l) => l.serial === "3")!.rate, 50); // raw reading untouched
});
