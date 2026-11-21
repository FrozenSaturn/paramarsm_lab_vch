import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkPages, chunkText, contentHash, splitSentences } from "./chunk";
import { extractionPassages } from "./extraction-text";
import { tidyPageText } from "./pdf-text";
import { senderKey, documentKind } from "./index-document";
import { snippetAround } from "./snippet";

const sentence = (i: number) => `Sentence number ${i} says the rate is ${30 + i} rupees per square foot.`;
const long = Array.from({ length: 40 }, (_, i) => sentence(i)).join(" ");

test("chunkText: no chunk is longer than maxChars, and nothing is lost", () => {
  const chunks = chunkText(long, { maxChars: 300, overlap: 80 });
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 300, `chunk of ${c.length}`);
  for (let i = 0; i < 40; i++) assert.ok(chunks.some((c) => c.includes(sentence(i))), `sentence ${i} is whole in a chunk`);
});

test("chunkText: the next chunk starts with the end of the chunk before it (overlap)", () => {
  const chunks = chunkText(long, { maxChars: 300, overlap: 80 });
  for (let i = 1; i < chunks.length; i++) {
    const firstSentence = chunks[i].split(/(?<=\.)\s/)[0];
    assert.ok(chunks[i - 1].includes(firstSentence), `chunk ${i} starts with text from chunk ${i - 1}`);
  }
  const none = chunkText(long, { maxChars: 300, overlap: 0 });
  assert.ok(none.length < chunks.length || none.length === chunks.length);
  assert.equal(none.join(" ").length, long.length);
});

test("chunkText: short text is one chunk; empty text is no chunk", () => {
  assert.deepEqual(chunkText("Warranty 10 years."), ["Warranty 10 years."]);
  assert.deepEqual(chunkText("   \n\n "), []);
});

test("chunkText: ends a chunk at a paragraph break when it is more than half full", () => {
  const p1 = Array.from({ length: 6 }, (_, i) => sentence(i)).join(" ");
  const p2 = Array.from({ length: 6 }, (_, i) => sentence(i + 10)).join(" ");
  const chunks = chunkText(`${p1}\n\n${p2}`, { maxChars: 600, overlap: 0 });
  assert.equal(chunks[0], p1);
  assert.equal(chunks[1], p2);
});

test("chunkText: a very long word is cut hard, not dropped", () => {
  const word = "x".repeat(250);
  const chunks = chunkText(word, { maxChars: 100, overlap: 0 });
  assert.equal(chunks.join(""), word);
  assert.ok(chunks.every((c) => c.length <= 100));
});

test("splitSentences: full stop, danda and numbered terms", () => {
  assert.deepEqual(splitSentences("Rate is 47. GST extra! Done"), ["Rate is 47.", "GST extra!", "Done"]);
  assert.deepEqual(splitSentences("ওয়ারেন্টি ১০ বছর। পেমেন্ট ৩০ দিনে।"), ["ওয়ারেন্টি ১০ বছর।", "পেমেন্ট ৩০ দিনে।"]);
  assert.deepEqual(splitSentences("Terms\n1 GST extra\n2 Free water"), ["Terms", "1 GST extra", "2 Free water"]);
});

test("chunkPages: keeps the page on each chunk and numbers chunks across pages", () => {
  const chunks = chunkPages([
    { page: 1, text: long },
    { page: 2, text: "" },
    { page: 3, text: "Warranty 10 years on stamp paper." },
  ], { maxChars: 400, overlap: 50 });
  assert.deepEqual(chunks.map((c) => c.chunk_index), chunks.map((_, i) => i));
  assert.ok(chunks.filter((c) => c.page === 1).length > 1);
  assert.equal(chunks.at(-1)!.page, 3);
  assert.ok(!chunks.some((c) => c.page === 2));
  assert.equal(chunks.at(-1)!.content_hash, contentHash("Warranty 10 years on stamp paper."));
  assert.match(chunks[0].content_hash, /^[0-9a-f]{64}$/);
});

test("tidyPageText: collapses spaces, keeps line breaks", () => {
  assert.equal(tidyPageText("  A   B \r\n\r\n\r\n\r\n C\t D  "), "A B\n\nC D");
});

const extraction = {
  is_scanned: true,
  header: {
    warranty: { value: "10 years", page: 6, snippet: "Warranty to be given for 10 years", confidence: 0.9 },
    gstin: { value: null, page: null, snippet: null, confidence: 0.9 },
  },
  lines: [
    { serial: "1", item: "WATERPROOFING AT TOILET FLOOR", unit: "SQFT", quantity: 30420, rate: 34, amount: null, make: null, rate_handwritten: true, page: 1, snippet: "1 SQFT 30420 34" },
    { serial: "4", item: "KITCHEN FLOOR", unit: "SQFT", quantity: 7590, rate: 34, amount: null, make: "Fosroc", rate_handwritten: true, page: 2, snippet: "4 SQFT 7590 34" },
  ],
  terms: [
    { term: "gst_extra", status: "met", detail: "GST at 18% extra", page: 6, snippet: "GST @ 18%" },
    { term: "tds", status: "not_stated", detail: "Not mentioned", page: null, snippet: null },
  ],
  stated_totals: [],
  vendor_conditions: [{ text: "Free water and electricity", page: 6 }],
};

test("extractionPassages: one text per page, with the page from the reading", () => {
  const pages = extractionPassages(extraction);
  assert.deepEqual(pages.map((p) => p.page), [1, 2, 6]);
  assert.match(pages[0].text, /Line 1: WATERPROOFING AT TOILET FLOOR, rate 34 per SQFT \(handwritten\), quantity 30420 SQFT/);
  assert.match(pages[1].text, /make Fosroc/);
  assert.match(pages[2].text, /Warranty: 10 years/);
  assert.match(pages[2].text, /GST at 18% extra/);
  assert.doesNotMatch(pages[2].text, /Not mentioned/);
});

test("extractionPassages: only some pages, or lines only", () => {
  assert.deepEqual(extractionPassages(extraction, { onlyPages: new Set([2]) }).map((p) => p.page), [2]);
  const lines = extractionPassages(extraction, { linesOnly: true });
  assert.deepEqual(lines.map((p) => p.page), [1, 2]);
  assert.deepEqual(extractionPassages(null), []);
});

test("senderKey and documentKind", () => {
  assert.deepEqual(senderKey("Bajrang <Me+Bajrang@Gmail.com>"), { email: "me+bajrang@gmail.com", phone: null });
  assert.deepEqual(senderKey("+91 97327 22394"), { email: null, phone: "919732722394" });
  assert.deepEqual(senderKey(null), { email: null, phone: null });
  assert.equal(documentKind({ mime: "application/pdf", filename: null }), "pdf");
  assert.equal(documentKind({ mime: null, filename: "rates.xlsx" }), "sheet");
  assert.equal(documentKind({ mime: "text/plain", filename: null }), "text");
  assert.equal(documentKind({ mime: "image/jpeg", filename: "scan.jpg" }), "other");
});

test("snippetAround: centres on the first query word", () => {
  const text = `${"filler ".repeat(100)}Warranty to be given for 10 years on stamp paper. ${"more ".repeat(100)}`;
  const snip = snippetAround(text, ["warranty"], 120);
  assert.ok(snip.includes("Warranty to be given"));
  assert.ok(snip.startsWith("… ") && snip.endsWith(" …"));
  assert.equal(snippetAround("short", ["x"]), "short");
});
