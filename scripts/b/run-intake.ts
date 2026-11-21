/**
 * Runs W5 on the dev quotes from the shell (no Next.js, no Inngest) and prints what was saved.
 * Needs scripts/seed/b/dev-fixtures.ts to have run.
 *
 *   QUOTE_READER=fixture npx tsx --env-file=.env scripts/b/run-intake.ts   # hand-checked readings, no model call
 *   npx tsx --env-file=.env scripts/b/run-intake.ts sk --force              # read SK again with Claude
 */
import { admin } from "../../src/lib/supabase";
import { runQuoteIntake } from "../../src/quotes/intake";
import { fmtINR } from "../../src/quotes/format";
import { FIXTURE_VENDOR_NAMES, fixtureBoqRaw, fixtureQuotes, type FixtureVendor } from "../../src/quotes/fixture-quotes";

const args = process.argv.slice(2);
const force = args.includes("--force");
const wanted = (args.filter((a) => !a.startsWith("--")).length ? args.filter((a) => !a.startsWith("--")) : fixtureQuotes.map((q) => q.vendor_key)) as FixtureVendor[];
const db = admin();

const { data: rfq, error } = await db.from("rfqs").select("id,case_id").eq("ref", fixtureBoqRaw.rfq.ref).single();
if (error || !rfq) throw new Error(`RFQ ${fixtureBoqRaw.rfq.ref} not found; run scripts/seed/b/dev-fixtures.ts --yes first`);
console.log(`Reader: ${process.env.QUOTE_READER === "fixture" ? "hand-checked fixtures (no model call)" : process.env.QUOTE_MODEL || "claude-opus-5-5"}\n`);

for (const key of wanted) {
  const q = fixtureQuotes.find((x) => x.vendor_key === key)!;
  const filename = q.file.split("/").pop()!;
  const { data: doc } = await db.from("documents").select("id").eq("case_id", rfq.case_id).eq("filename", filename).single();
  const { data: vendor } = await db.from("vendors").select("id").eq("name", FIXTURE_VENDOR_NAMES[key]).single();
  if (!doc || !vendor) throw new Error(`missing document or vendor for ${key}`);
  const out = await runQuoteIntake({ case_id: rfq.case_id, rfq_id: rfq.id, vendor_id: vendor.id, document_id: doc.id }, { force });
  if (out.skipped) { console.log(`${FIXTURE_VENDOR_NAMES[key]}: already read (quote ${out.quote_id}); pass --force to read again`); continue; }
  const n = out.normalised;
  console.log(`${FIXTURE_VENDOR_NAMES[key]}: quote ${out.quote_id}`);
  console.log(`  ${fmtINR(n.total_on_boq)} on Vinayak's quantities (${n.comparable_lines}/${n.boq_lines} lines), scope ${n.scope}, needs review: ${n.needs_review}`);
  for (const f of n.flags.filter((f) => f.severity !== "info")) console.log(`  [${f.code}] ${f.message}`);
}
