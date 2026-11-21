/**
 * Reads the sample quotes with Claude, normalises them, and scores the reading against
 * the hand-checked ground truth in fixtures/quotes.json. No database needed.
 *
 *   npx tsx --env-file=.env scripts/b/eval-read.ts            # all four
 *   npx tsx --env-file=.env scripts/b/eval-read.ts sk bajrang # some
 *
 * Writes each raw reading to fixtures/readings/<vendor>.json (gitignored) so later
 * stages can be built without paying for the read again.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readQuotePdf } from "../../src/quotes/reader";
import { normaliseQuote } from "../../src/quotes/normalise";
import { DEFAULT_TERMS } from "../../src/quotes/terms";
import { fixtureBoq, fixtureFor, fixtureQuotes, fixtureRfqSentAt, FIXTURE_VENDOR_NAMES, type FixtureVendor } from "../../src/quotes/fixture-quotes";
import { fmtINR } from "../../src/quotes/format";

const wanted = (process.argv.slice(2).length ? process.argv.slice(2) : fixtureQuotes.map((q) => q.vendor_key)) as FixtureVendor[];
let totalCost = 0;
let fieldErrors = 0;

for (const key of wanted) {
  const truth = fixtureFor(key);
  const vendor = { name: FIXTURE_VENDOR_NAMES[key] };
  process.stdout.write(`\n=== ${vendor.name} (${truth.file.split("/").pop()})\n`);
  const pdf = await readFile(truth.file);
  const r = await readQuotePdf(pdf, { boq: fixtureBoq, terms: DEFAULT_TERMS, vendorHint: vendor.name });
  await mkdir("fixtures/readings", { recursive: true });
  await writeFile(`fixtures/readings/${key}.json`, JSON.stringify(r, null, 2));
  for (const c of r.calls) {
    totalCost += c.cost_usd;
    console.log(`  model ${c.model} (${c.prompt_version}): ${c.input_tokens} in / ${c.output_tokens} out, $${c.cost_usd.toFixed(3)}, ${(c.ms / 1000).toFixed(1)} s`);
  }

  // Score the reading field by field
  const errs: string[] = [];
  const h = r.extracted.header;
  if ((h.quote_date.value ?? null) !== truth.header.quote_date) errs.push(`quote_date: read ${h.quote_date.value}, expected ${truth.header.quote_date}`);
  if (truth.header.gstin && h.gstin.value?.replace(/\s/g, "") !== truth.header.gstin) errs.push(`gstin: read ${h.gstin.value}, expected ${truth.header.gstin}`);
  for (const t of truth.lines) {
    const got = r.extracted.lines.find((l) => l.serial.replace(/\D/g, "") === t.serial);
    if (!got) { errs.push(`line ${t.serial}: missing`); continue; }
    if (got.boq_serial !== t.boq_serial) errs.push(`line ${t.serial} boq_serial: ${got.boq_serial} ≠ ${t.boq_serial}`);
    if (got.quantity !== t.quantity) errs.push(`line ${t.serial} quantity: ${got.quantity} ≠ ${t.quantity}`);
    if (got.rate !== t.rate) errs.push(`line ${t.serial} rate: ${got.rate} ≠ ${t.rate}`);
    if ((got.amount ?? null) !== t.amount) errs.push(`line ${t.serial} amount: ${got.amount} ≠ ${t.amount}`);
    if (got.page !== t.page) errs.push(`line ${t.serial} page: ${got.page} ≠ ${t.page}`);
    if (got.rate_handwritten !== t.handwritten) errs.push(`line ${t.serial} handwritten: ${got.rate_handwritten} ≠ ${t.handwritten}`);
  }
  for (const [k, want] of Object.entries(truth.terms)) {
    const got = r.extracted.terms.find((x) => x.term === k)?.status;
    if (got !== want) errs.push(`term ${k}: ${got} ≠ ${want} (judgement, not a reading error)`);
  }
  if (r.secondRead) {
    console.log(`  second read of handwriting: ${r.secondRead.rates.map((x) => `${x.serial}=${x.rate ?? "?"}`).join(" ")}`);
  }
  fieldErrors += errs.filter((e) => !e.includes("judgement")).length;
  console.log(errs.length ? errs.map((e) => "  ✗ " + e).join("\n") : "  ✓ every checked field matches the ground truth");

  const n = normaliseQuote(r.extracted, { boq: fixtureBoq, rfqSentAt: fixtureRfqSentAt, secondRead: r.secondRead });
  console.log(`  on Vinayak's quantities: ${fmtINR(n.total_on_boq)} over ${n.comparable_lines}/${n.boq_lines} lines; scope ${n.scope}; needs review: ${n.needs_review}`);
  for (const f of n.flags) console.log(`  [${f.severity}] ${f.code}: ${f.message}`);
}
console.log(`\nReading errors: ${fieldErrors}. Model cost: $${totalCost.toFixed(3)}`);
process.exitCode = fieldErrors ? 1 : 0;
