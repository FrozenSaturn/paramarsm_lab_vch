/**
 * Stage 4: builds a recommendation from the newest comparative of a case and prints the
 * explanation with its fact ids and proof targets.
 *
 *   npm run recommend:run                      # the Amara Tower-2 case
 *   npm run recommend:run -- <case-id>
 *   npm run recommend:run -- <case-id> --compare   # run a new comparative first
 *
 * It writes a recommendations row (status draft), marks older draft or with_hod rows
 * superseded and proposes a notify_hod action, on the database it points to. It may call Claude.
 */
import { admin } from "../../src/lib/supabase";
import { buildRecommendation } from "../../src/compare/recommend";
import { runComparative } from "../../src/compare/run";
import { validateExplanation } from "../../src/agents/b/explain-check";
import type { FactProof } from "../../src/compare/recommend-facts";

const AMARA_CASE = "37b762dc-2e9f-4dde-a7ff-f2a20a3dc7f4";
const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith("--")) ?? AMARA_CASE;
const db = admin();

let comparativeId: string;
if (args.includes("--compare")) {
  comparativeId = (await runComparative({ caseId, trigger: "script", actor: "scripts/b/run-recommend" })).comparativeId;
} else {
  const { data, error } = await db.from("comparatives").select("id,version").eq("case_id", caseId).order("version", { ascending: false }).limit(1);
  if (error) throw error;
  if (!data?.length) throw new Error(`Case ${caseId} has no comparative. Run with --compare or npm run compare:run first.`);
  comparativeId = data[0].id;
  console.log(`Newest comparative: v${data[0].version} (${comparativeId})`);
}

const r = await buildRecommendation({ comparativeId, actor: "scripts/b/run-recommend" });
const factById = new Map(r.facts.map((f) => [f.id, f]));
const proof = (p: FactProof) => {
  switch (p.type) {
    case "pdf_page": return `PDF ${p.document_id?.slice(0, 8)}… page ${p.page}${p.row ? ` (line ${p.row})` : ""}`;
    case "comparative": return `comparative ${p.comparative_id?.slice(0, 8)}…${p.row ? ` line ${p.row}` : ""}`;
    case "quote": return `quote ${p.quote_id?.slice(0, 8)}…`;
    case "performance": return `work-order record ${p.record_id?.slice(0, 8)}…`;
    case "message": return `message ${p.message_id?.slice(0, 8)}…`;
  }
};
const cite = (ids: string[]) => ids.map((id) => { const f = factById.get(id); return `      ${id} → ${f ? proof(f.proof) : "?"}`; }).join("\n");

console.log(`\nRecommendation ${r.recommendationId} (case ${r.caseId})`);
console.log(`Status draft · top vendor ${r.topVendorId ?? "— (withheld)"} · notify_hod action ${r.notifyActionId ?? "none"} · superseded ${r.superseded.length}`);
console.log(`Explanation source: ${r.source}${r.model ? ` (${r.model})` : ""} · cost $${r.costUsd.toFixed(4)}`);
if (r.errors.length) { console.log("Checks and fallbacks:"); for (const e of r.errors) console.log(`  - ${e}`); }

console.log(`\nFacts (${r.facts.length}):`);
for (const f of r.facts) console.log(`  ${f.id.padEnd(4)} ${f.text}\n       proof: ${proof(f.proof)}`);

console.log("\nSummary:");
for (const s of r.explanation.summary) console.log(`  • ${s.text}  [${s.fact_ids.join(", ")}]\n${cite(s.fact_ids)}`);
const { data: rec } = await db.from("recommendations").select("ranking").eq("id", r.recommendationId).single();
const names = new Map(((rec?.ranking ?? []) as { vendor_id: string; name: string }[]).map((x) => [x.vendor_id, x.name]));
for (const v of r.explanation.vendors) {
  console.log(`\n${names.get(v.vendor_id) ?? v.vendor_id}:`);
  for (const s of v.reasons) console.log(`  • ${s.text}  [${s.fact_ids.join(", ")}]\n${cite(s.fact_ids)}`);
}

const errs = validateExplanation(r.explanation, r.facts, r.explanation.vendors.map((v) => v.vendor_id));
console.log(errs.length ? `\nFAILED re-check:\n${errs.join("\n")}` : "\nRe-check: every sentence cites existing facts and uses only their numbers.");
process.exit(errs.length ? 1 : 0);
