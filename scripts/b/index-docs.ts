/**
 * Index every document on a case for search (chunks and embeddings in doc_chunks).
 *
 * Usage: npm run index:docs -- [case_id] [--force] [--all-types]
 * Default case: the Amara Tower-2 case on the shared project. Default: PDF documents only.
 * The first run downloads the embedding model (about 120 MB). Allow a few minutes.
 */
import { admin } from "@/lib/supabase";
import { indexDocument } from "@/search/index-document";

const AMARA_CASE = "37b762dc-2e9f-4dde-a7ff-f2a20a3dc7f4";
const args = process.argv.slice(2);
const force = args.includes("--force");
const allTypes = args.includes("--all-types");
const caseId = args.find((a) => !a.startsWith("--")) ?? AMARA_CASE;

let query = admin().from("documents").select("id,filename,mime").eq("case_id", caseId).order("filename");
if (!allTypes) query = query.ilike("mime", "%pdf%");
const { data: docs, error } = await query;
if (error) throw error;
if (!docs?.length) {
  console.log(`No documents on case ${caseId}.`);
  process.exit(0);
}

console.log(`Indexing ${docs.length} document(s) on case ${caseId}${force ? " (force)" : ""}`);
let failed = 0;
for (const d of docs) {
  try {
    const r = await indexDocument(d.id, { force });
    const extra = r.pages_from_extraction?.length ? `, from quote reading: pages ${r.pages_from_extraction.join(",")}` : "";
    console.log(`  ${r.status.padEnd(9)} ${String(r.chunks).padStart(3)} chunks  ${d.filename}  (${r.ms} ms${extra}${r.reason ? `; ${r.reason}` : ""})`);
  } catch (e) {
    failed++;
    console.log(`  FAILED        ${d.filename}: ${(e as Error).message}`);
  }
}
const { count } = await admin().from("doc_chunks").select("id", { count: "exact", head: true }).eq("case_id", caseId);
console.log(`doc_chunks on this case: ${count}`);
process.exit(failed ? 1 : 0);
