import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordQuery, keywordTerms, mergeHits, pickRareTerms, type SearchHit } from "./hybrid";
import { detectLanguage, hasNonLatinScript } from "./lang";
import { cleanTranslation } from "./translate";

const hit = (id: string, score: number, more: Partial<SearchHit> = {}): SearchHit => ({
  id, text: id, source_id: "d1", source_type: "document", document_id: "d1", message_id: null, page: 1,
  score, vector_score: null, keyword_score: null, ...more,
});

test("mergeHits: one hit per chunk with its best score, best first, cut to the limit", () => {
  const a = [hit("x", 0.016, { vector_score: 0.8 }), hit("y", 0.015, { vector_score: 0.7 })];
  const b = [hit("y", 0.032, { vector_score: 0.75, keyword_score: 0.9 }), hit("z", 0.01, { keyword_score: 0.2 })];
  const m = mergeHits([a, b], 10);
  assert.deepEqual(m.map((h) => h.id), ["y", "x", "z"]);
  assert.equal(m[0].score, 0.032);
  assert.equal(m[0].vector_score, 0.75);
  assert.equal(m[0].keyword_score, 0.9);
  assert.deepEqual(mergeHits([a, b], 2).map((h) => h.id), ["y", "x"]);
});

test("mergeHits: keeps the best vector and keyword scores from both runs", () => {
  const m = mergeHits([[hit("x", 0.02, { vector_score: 0.9 })], [hit("x", 0.03, { vector_score: 0.7, keyword_score: 0.5 })]], 5);
  assert.equal(m.length, 1);
  assert.equal(m[0].score, 0.03);
  assert.equal(m[0].vector_score, 0.9);
  assert.equal(m[0].keyword_score, 0.5);
});

test("mergeHits: equal scores sort by id, so results are repeatable", () => {
  assert.deepEqual(mergeHits([[hit("b", 0.01), hit("a", 0.01)]], 5).map((h) => h.id), ["a", "b"]);
});

test("keywordTerms and keywordQuery: drop stop words, join with OR", () => {
  assert.deepEqual(keywordTerms("Which vendor gives a 10 year warranty?"), ["vendor", "10", "year", "warranty"]);
  assert.equal(keywordQuery("Which vendor gives a 10 year warranty?"), "vendor or 10 or year or warranty");
  assert.equal(keywordQuery("the"), "the");
  assert.deepEqual(keywordTerms("Brushbond RFX below 40 brushbond"), ["brushbond", "rfx", "below", "40"]);
  assert.deepEqual(keywordTerms("কোন ভেন্ডর CICO"), ["কোন", "ভেন্ডর", "cico"]);
});

test("pickRareTerms: drops words found in most chunks, keeps the rarest when all are common", () => {
  const df = new Map([["fosroc", 80], ["cico", 1], ["brand", 2], ["waterproofing", 100]]);
  assert.deepEqual(pickRareTerms(["fosroc", "cico", "brand"], df, 112), ["cico", "brand"]);
  assert.deepEqual(pickRareTerms(["fosroc", "waterproofing"], df, 112), ["fosroc"]);
  assert.deepEqual(pickRareTerms(["fosroc", "cico"], df, 10), ["fosroc", "cico"], "small corpus: no pruning");
});

test("script detection: Bengali and Hindi need translation, English does not", () => {
  assert.equal(hasNonLatinScript("কোন ভেন্ডর ১০ বছরের ওয়ারেন্টি দিচ্ছে?"), true);
  assert.equal(hasNonLatinScript("किस वेंडर ने"), true);
  assert.equal(hasNonLatinScript("Who quoted Brushbond below 40?"), false);
  assert.equal(hasNonLatinScript("Rate ₹47 – SQFT"), false);
  assert.equal(detectLanguage("কোন ভেন্ডর CICO ব্যবহার করবে"), "bn");
  assert.equal(detectLanguage("भुगतान की शर्तें"), "hi");
  assert.equal(detectLanguage("Payment terms will fix after discussion"), "en");
  assert.equal(detectLanguage(""), "en");
});

test("cleanTranslation: one clean line, or null", () => {
  assert.equal(cleanTranslation('English: "Which vendor offers a 10-year warranty?"\n'), "Which vendor offers a 10-year warranty?");
  assert.equal(cleanTranslation("  "), null);
  assert.equal(cleanTranslation("x".repeat(600)), null);
});
