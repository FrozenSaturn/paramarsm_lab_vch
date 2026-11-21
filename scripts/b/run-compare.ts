/**
 * Stage 3 "test alone": runs W6 twice on a case from the shell (no Next.js, no Inngest),
 * prints the comparison, and checks the numbers.
 *
 *   npm run compare:run                                # the Amara dev case (RFQ DEV-B-RFQ-AMARA-WP)
 *   npm run compare:run -- <case-id> --excel /tmp/cs.xlsx
 *
 * Checks (exit 1 on any failure):
 * - The two runs have the same inputs hash and the same matrix and scores JSON.
 * - The stored rows read back equal what the run returned.
 * - Every amount is rate × quantity (2 places); every total re-derives from the amounts.
 * - Every score total is the sum of its contributions; every contribution is weight × score ÷ 100.
 * - On the Amara case, the before-GST totals equal the hand-checked numbers.
 *
 * Each run writes a new comparatives version on the database it points to.
 */
import { writeFile } from "node:fs/promises";
import { admin } from "../../src/lib/supabase";
import { runComparative, type RunComparativeResult } from "../../src/compare/run";
import { loadComparative } from "../../src/compare/stored";
import { canonicalJson } from "../../src/compare/matrix";
import { comparativeWorkbook } from "../../src/compare/excel";
import { fmtINR } from "../../src/quotes/format";
import { round } from "../../src/quotes/units";
import { fixtureBoqRaw } from "../../src/quotes/fixture-quotes";

const args = process.argv.slice(2);
const excelAt = args.includes("--excel") ? args[args.indexOf("--excel") + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--excel");
const db = admin();

let caseId = positional[0];
if (!caseId) {
  const { data: rfq } = await db.from("rfqs").select("case_id").eq("ref", fixtureBoqRaw.rfq.ref).maybeSingle();
  if (!rfq) throw new Error(`No case id given and RFQ ${fixtureBoqRaw.rfq.ref} not found`);
  caseId = rfq.case_id;
}

/** Hand-checked before-GST totals on Vinayak's quantities (W5, Amara Tower-2). Keyed by vendor name prefix. */
const KNOWN_BEFORE_GST: Record<string, number> = { Bajrang: 1376412.01, Purvyakruti: 1898612.0, Shyama: 1704240.8, "S.K.": 1381464.0 };

const failures: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); };
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function print(r: RunComparativeResult, label: string) {
  console.log(`\n${label}: comparative v${r.version} (${r.comparativeId}), inputs ${r.inputsHash.slice(0, 16)}…, weights "${r.category}", as of ${r.matrix.as_of}`);
  console.log(`${pad("Vendor", 34)} ${lpad("Before GST", 16)} ${lpad("GST", 22)} ${lpad("Landed", 16)} ${lpad("Loading", 12)} ${lpad("Landed for price", 17)} ${lpad("Score", 7)} ${lpad("Rank", 5)}  Risk flags`);
  for (const v of r.matrix.vendors) {
    const t = r.matrix.totals[v.vendor_id];
    const s = r.scores.find((x) => x.vendor_id === v.vendor_id)!;
    const gst = `${fmtINR(t.gst)} (${round(t.gst_rate * 100)}% ${t.gst_basis === "assumed_standard" ? "assumed" : t.gst_basis})`;
    console.log(`${pad(v.name, 34)} ${lpad(fmtINR(t.before_gst), 16)} ${lpad(gst, 22)} ${lpad(fmtINR(t.landed), 16)} ${lpad(t.loading ? fmtINR(t.loading) : "—", 12)} ${lpad(fmtINR(t.landed_for_price), 17)} ${lpad(String(s.total), 7)} ${lpad(String(s.rank ?? "—"), 5)}  ${s.risk_flags.map((f) => f.code).join(", ") || "—"}`);
    console.log(`  ${s.params.map((p) => `${p.param} ${p.score}${p.label ? ` (${p.label})` : ""}`).join(" · ")}`);
  }
  const low = r.matrix.lowest_landed_vendor_id;
  console.log(`Lowest landed for price: ${r.matrix.vendors.find((v) => v.vendor_id === low)?.name ?? "—"}. Ranking withheld: ${r.matrix.ranking_withheld}.`);
  for (const n of r.matrix.notes) console.log(`  note: ${n}`);
}

/** Re-derives every amount and total from rate × quantity, and every score total from its parts. */
function rederive(r: RunComparativeResult, label: string) {
  const m = r.matrix;
  let cells = 0;
  for (const row of m.rows) {
    const amounts: number[] = [];
    for (const v of m.vendors) {
      const c = row.cells[v.vendor_id];
      check(!!c, `${label}: line ${row.serial} has no cell for ${v.name}`);
      if (c.amount != null) {
        cells++;
        check(c.rate != null && row.quantity != null && c.amount === round(c.rate * row.quantity, 2),
          `${label}: line ${row.serial} ${v.name}: amount ${c.amount} ≠ ${c.rate} × ${row.quantity}`);
        amounts.push(c.amount);
      }
      check(c.missing === (row.quantity != null && c.amount == null), `${label}: line ${row.serial} ${v.name}: missing flag is wrong`);
    }
    // Lowest (all four Amara quotes are GST-extra or assumed, so the cell amounts compare directly).
    if (m.vendors.every((v) => m.totals[v.vendor_id].gst_basis !== "inclusive") && amounts.length) {
      const min = Math.min(...amounts);
      for (const v of m.vendors) {
        const c = row.cells[v.vendor_id];
        check(c.lowest === (c.amount != null && c.amount === min), `${label}: line ${row.serial} ${v.name}: lowest flag is wrong`);
      }
    }
  }
  for (const v of m.vendors) {
    const t = m.totals[v.vendor_id];
    const cs = m.rows.map((row) => row.cells[v.vendor_id]);
    const sum = round(cs.reduce((s, c) => s + (c.amount ?? 0), 0), 2);
    const before = t.gst_basis === "inclusive" ? round(sum / (1 + t.gst_rate), 2) : sum;
    const gst = t.gst_basis === "inclusive" ? round(sum - before, 2) : round(before * t.gst_rate, 2);
    const loading = round(cs.reduce((s, c) => s + (c.missing ? c.loaded_amount ?? 0 : 0), 0), 2);
    check(t.before_gst === before, `${label}: ${v.name}: before GST ${t.before_gst} ≠ Σ amounts ${before}`);
    check(t.gst === gst, `${label}: ${v.name}: GST ${t.gst} ≠ ${gst}`);
    check(t.landed === round(before + gst, 2), `${label}: ${v.name}: landed ${t.landed} ≠ ${round(before + gst, 2)}`);
    check(t.loading === loading, `${label}: ${v.name}: loading ${t.loading} ≠ ${loading}`);
    check(t.landed_for_price === round((before + loading) * (1 + t.gst_rate), 2), `${label}: ${v.name}: landed for price is wrong`);
    check(t.lines_priced === cs.filter((c) => c.amount != null).length, `${label}: ${v.name}: lines priced is wrong`);
    for (const [prefix, want] of Object.entries(KNOWN_BEFORE_GST)) {
      if (v.name.startsWith(prefix)) check(t.before_gst === want, `${label}: ${v.name}: before GST ${t.before_gst} ≠ hand-checked ${want}`);
    }
  }
  const priced = m.vendors.filter((v) => m.totals[v.vendor_id].lines_priced > 0);
  const minLfp = Math.min(...priced.map((v) => m.totals[v.vendor_id].landed_for_price));
  check(m.lowest_landed_vendor_id != null && m.totals[m.lowest_landed_vendor_id].landed_for_price === minLfp, `${label}: lowest landed vendor is wrong`);
  for (const s of r.scores) {
    for (const p of s.params) {
      check(p.weight === r.weights[p.param], `${label}: ${s.vendor_id} ${p.param}: weight ${p.weight} ≠ ${r.weights[p.param]}`);
      check(p.contribution === round((p.weight * p.score) / 100, 2), `${label}: ${s.vendor_id} ${p.param}: contribution is wrong`);
      check(p.score >= 0 && p.score <= 100, `${label}: ${s.vendor_id} ${p.param}: score out of range`);
    }
    check(s.total === round(s.params.reduce((a, p) => a + p.contribution, 0), 2), `${label}: ${s.vendor_id}: total ≠ Σ contributions`);
  }
  console.log(`${label}: re-derived ${cells} amounts, ${m.vendors.length} vendor totals and ${r.scores.length} score totals.`);
}

async function storedMatches(r: RunComparativeResult, label: string) {
  const s = await loadComparative(r.comparativeId);
  check(!!s, `${label}: comparative ${r.comparativeId} not found after save`);
  if (!s) return;
  check(canonicalJson(s.matrix) === canonicalJson(r.matrix), `${label}: stored matrix differs from the computed matrix`);
  const byV = (xs: { vendor_id: string }[]) => [...xs].sort((a, b) => (a.vendor_id < b.vendor_id ? -1 : 1));
  check(canonicalJson(byV(s.scores)) === canonicalJson(byV(r.scores)), `${label}: stored scores differ from the computed scores`);
  check(s.inputs_hash === r.inputsHash, `${label}: stored inputs hash differs`);
}

const a = await runComparative({ caseId, trigger: "script", actor: "scripts/b/run-compare" });
print(a, "Run 1");
const b = await runComparative({ caseId, trigger: "script", actor: "scripts/b/run-compare" });
print(b, "Run 2");

console.log("");
check(a.inputsHash === b.inputsHash, `inputs hash differs: ${a.inputsHash} vs ${b.inputsHash}`);
check(canonicalJson(a.matrix) === canonicalJson(b.matrix), "matrix JSON differs between the two runs");
check(JSON.stringify(a.matrix) === JSON.stringify(b.matrix), "matrix JSON (key order) differs between the two runs");
check(canonicalJson(a.scores) === canonicalJson(b.scores), "scores JSON differs between the two runs");
check(b.version === a.version + 1, `second run is v${b.version}, expected v${a.version + 1}`);
console.log(`Determinism: inputs hash ${a.inputsHash === b.inputsHash ? "equal" : "DIFFERENT"}; matrix ${canonicalJson(a.matrix) === canonicalJson(b.matrix) ? "identical" : "DIFFERENT"}; scores ${canonicalJson(a.scores) === canonicalJson(b.scores) ? "identical" : "DIFFERENT"}.`);
rederive(a, "Run 1");
rederive(b, "Run 2");
await storedMatches(a, "Run 1");
await storedMatches(b, "Run 2");

if (excelAt) {
  const s = await loadComparative(b.comparativeId);
  const { data: kase } = await db.from("cases").select("title").eq("id", caseId).maybeSingle();
  const { data: rfq } = b.input.rfq_id ? await db.from("rfqs").select("ref").eq("id", b.input.rfq_id).maybeSingle() : { data: null };
  const buf = await comparativeWorkbook({
    matrix: b.matrix, scores: b.scores, weights: b.weights,
    meta: { caseTitle: kase?.title ?? caseId, rfqRef: (rfq as any)?.ref ?? null, version: b.version, createdAt: s?.created_at ?? new Date().toISOString() },
  });
  await writeFile(excelAt, buf);
  console.log(`Excel written: ${excelAt} (${buf.length} bytes)`);
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
process.exit(0);
