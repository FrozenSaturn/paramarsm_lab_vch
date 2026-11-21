/**
 * B dev data for W5, on top of A's master seed (run `npm run seed` first).
 *
 * A's seed has the Amara case, the four quoting vendors and the site sheet's BOQ, but not yet
 * what the tender and RFQ steps produce. This adds only that, found by natural keys so it is
 * safe to re-run, and marked as B dev data:
 *   - the tender PDF and the four quote PDFs in Storage, each with a documents row
 *   - the tender BOQ (7 lines, SQFT) as an accepted BOQ version whose source is the tender PDF
 *   - an RFQ (ref DEV-B-RFQ-AMARA-WP) sent to the four vendors on 16.11.2026
 *
 * These are A's tables on the shared database, so it needs --yes. --remove deletes exactly
 * these rows again (and any quotes B read from these PDFs).
 *
 *   npx tsx --env-file=.env scripts/seed/b/dev-fixtures.ts --yes
 *   npx tsx --env-file=.env scripts/seed/b/dev-fixtures.ts --remove --yes
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { admin } from "../../../src/lib/supabase";
import { STORAGE_BUCKET } from "../../../src/quotes/source";
import { DEFAULT_TERMS, TERM_KEYS } from "../../../src/quotes/terms";
import { FIXTURE_VENDOR_NAMES, fixtureBoqRaw, fixtureQuotes, type FixtureVendor } from "../../../src/quotes/fixture-quotes";

const CASE_TITLE = "Waterproofing - Amara Tower-2"; // as A's master seed names it
const RFQ = fixtureBoqRaw.rfq;
const STORAGE_PREFIX = "dev-b";
const remove = process.argv.includes("--remove");

if (!process.argv.includes("--yes")) {
  console.error(`This ${remove ? "removes" : "adds"} B dev data in A's tables (documents, boq_versions, boq_lines, rfqs, rfq_recipients)`);
  console.error(`and Storage bucket "${STORAGE_BUCKET}" on ${process.env.NEXT_PUBLIC_SUPABASE_URL}. Re-run with --yes to go ahead.`);
  process.exit(1);
}

const db = admin();
const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
/** For queries that return rows: never null. */
const rows = <T>(r: { data: T[] | null; error: { message: string } | null }, what: string): T[] => must(r, what) ?? [];
/** For single-row inserts and selects that must find a row. */
const one = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  const d = must(r, what);
  if (d == null) throw new Error(`${what}: no row`);
  return d;
};

const caseRow = must(await db.from("cases").select("id,title").eq("title", CASE_TITLE).maybeSingle(), "find case");
if (!caseRow) throw new Error(`No case titled "${CASE_TITLE}". Run A's seed first (npm run seed).`);
const caseId: string = caseRow.id;

const files = [
  { file: fixtureBoqRaw.source, kind: "tender", vendor: null as FixtureVendor | null },
  ...fixtureQuotes.map((q) => ({ file: q.file, kind: "quote", vendor: q.vendor_key as FixtureVendor })),
];
const withHash = await Promise.all(files.map(async (f) => {
  const bytes = await readFile(f.file);
  return { ...f, bytes, filename: f.file.split("/").pop()!, sha256: createHash("sha256").update(bytes).digest("hex") };
}));

if (remove) {
  const docs = rows(await db.from("documents").select("id,storage_path").eq("case_id", caseId).in("sha256", withHash.map((f) => f.sha256)), "find documents");
  const docIds = docs.map((d: any) => d.id);
  const quotes = docIds.length ? rows(await db.from("quotes").select("id").in("document_id", docIds), "find quotes") : [];
  const quoteIds = quotes.map((q: any) => q.id);
  if (quoteIds.length) {
    const lines = rows(await db.from("quote_lines").select("id").in("quote_id", quoteIds), "find lines");
    const terms = rows(await db.from("quote_terms").select("id").in("quote_id", quoteIds), "find terms");
    const entityIds = [...quoteIds, ...lines.map((l: any) => l.id), ...terms.map((t: any) => t.id)];
    must(await db.from("extracted_fields").delete().in("entity_id", entityIds), "delete evidence");
    must(await db.from("quote_lines").delete().in("quote_id", quoteIds), "delete quote lines");
    must(await db.from("quote_terms").delete().in("quote_id", quoteIds), "delete quote terms");
    must(await db.from("quotes").delete().in("id", quoteIds), "delete quotes");
  }
  const rfq = must(await db.from("rfqs").select("id").eq("ref", RFQ.ref).maybeSingle(), "find rfq");
  if (rfq) {
    must(await db.from("rfq_recipients").delete().eq("rfq_id", rfq.id), "delete recipients");
    must(await db.from("rfqs").delete().eq("id", rfq.id), "delete rfq");
  }
  const tender = docs.find((d: any) => d.storage_path.endsWith(fixtureBoqRaw.source.split("/").pop()!));
  if (tender) {
    const versions = rows(await db.from("boq_versions").select("id").eq("case_id", caseId).eq("source_document_id", tender.id), "find tender BOQ");
    for (const v of versions) {
      must(await db.from("boq_lines").delete().eq("boq_version_id", v.id), "delete BOQ lines");
      must(await db.from("boq_versions").delete().eq("id", v.id), "delete BOQ version");
    }
  }
  if (docIds.length) must(await db.from("documents").delete().in("id", docIds), "delete documents");
  if (docs.length) await db.storage.from(STORAGE_BUCKET).remove(docs.map((d: any) => d.storage_path));
  console.log(`Removed B dev data from "${CASE_TITLE}": ${quoteIds.length} quotes, ${docIds.length} documents, RFQ ${rfq ? RFQ.ref : "(none)"}.`);
  process.exit(0);
}

// Vendors from A's seed, by name, with the plus-address A's seed gave each one.
const vendorIds = {} as Record<FixtureVendor, string>;
const vendorEmails = {} as Record<FixtureVendor, string | null>;
for (const [key, name] of Object.entries(FIXTURE_VENDOR_NAMES) as [FixtureVendor, string][]) {
  const v = must(await db.from("vendors").select("id").eq("name", name).maybeSingle(), `find vendor ${name}`);
  if (!v) throw new Error(`Vendor "${name}" not found. Run A's seed first (npm run seed).`);
  vendorIds[key] = v.id;
  const c = rows(await db.from("vendor_contacts").select("email").eq("vendor_id", v.id).not("email", "is", null).limit(1), "find contact");
  vendorEmails[key] = c[0]?.email ?? null;
}

// Storage and documents
const { error: bucketErr } = await db.storage.createBucket(STORAGE_BUCKET, { public: false });
if (bucketErr && !/exist/i.test(bucketErr.message)) throw new Error(`create bucket: ${bucketErr.message}`);
const docId: Record<string, string> = {};
for (const f of withHash) {
  const storage_path = `${STORAGE_PREFIX}/${f.filename}`;
  const up = await db.storage.from(STORAGE_BUCKET).upload(storage_path, f.bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`upload ${f.filename}: ${up.error.message}`);
  const found = must(await db.from("documents").select("id").eq("case_id", caseId).eq("sha256", f.sha256).maybeSingle(), "find document");
  docId[f.filename] = found?.id ?? one<{ id: string }>(
    await db.from("documents").insert({ case_id: caseId, filename: f.filename, mime: "application/pdf", storage_path, kind: f.kind, sha256: f.sha256 }).select("id").single(),
    `insert document ${f.filename}`,
  ).id;
}
const tenderDocId = docId[fixtureBoqRaw.source.split("/").pop()!];

// The tender BOQ as an accepted version, identified by its source document.
let boq = must(await db.from("boq_versions").select("id,version").eq("case_id", caseId).eq("source_document_id", tenderDocId).maybeSingle(), "find tender BOQ");
if (!boq) {
  const latest = rows(await db.from("boq_versions").select("version").eq("case_id", caseId).order("version", { ascending: false }).limit(1), "latest BOQ");
  boq = one<{ id: string; version: number }>(
    await db.from("boq_versions").insert({ case_id: caseId, version: (latest[0]?.version ?? 0) + 1, status: "accepted", source_document_id: tenderDocId }).select("id,version").single(),
    "insert tender BOQ",
  );
}
for (const l of fixtureBoqRaw.lines) {
  const row = { boq_version_id: boq!.id, serial: l.serial, description: l.description, unit: l.unit, quantity: l.quantity, flags: [{ type: "source", value: "tender PDF (B dev data)" }] };
  const existing = must(await db.from("boq_lines").select("id").eq("boq_version_id", boq!.id).eq("serial", l.serial).maybeSingle(), "find BOQ line");
  if (existing) must(await db.from("boq_lines").update(row).eq("id", existing.id), "update BOQ line");
  else must(await db.from("boq_lines").insert(row), "insert BOQ line");
}

// The RFQ that went out, with the six standard terms in A's { id, text } shape.
const rfqRow = {
  case_id: caseId, ref: RFQ.ref, due_date: RFQ.due_date, status: "sent",
  terms: TERM_KEYS.map((id) => ({ id, text: DEFAULT_TERMS[id].text })),
};
const rfq = one<{ id: string }>(await db.from("rfqs").upsert(rfqRow, { onConflict: "ref" }).select("id").single(), "upsert RFQ");
for (const key of Object.keys(vendorIds) as FixtureVendor[]) {
  const row = { rfq_id: rfq.id, vendor_id: vendorIds[key], email: vendorEmails[key], sent_at: RFQ.sent_at, status: "sent" };
  const existing = must(await db.from("rfq_recipients").select("id").eq("rfq_id", rfq.id).eq("vendor_id", vendorIds[key]).maybeSingle(), "find recipient");
  if (existing) must(await db.from("rfq_recipients").update(row).eq("id", existing.id), "update recipient");
  else must(await db.from("rfq_recipients").insert(row), "insert recipient");
}

console.log(`B dev data on "${CASE_TITLE}" (${caseId}):`);
console.log(`  tender BOQ = version ${boq!.version} (accepted, 7 lines SQFT); RFQ ${RFQ.ref} (${rfq.id}) sent to 4 vendors`);
for (const f of withHash.filter((x) => x.vendor)) console.log(`  ${FIXTURE_VENDOR_NAMES[f.vendor!].padEnd(38)} vendor ${vendorIds[f.vendor!]}  document ${docId[f.filename]}`);
console.log(`Open /dev/quotes?case=${caseId}, or run W5 from the shell: npx tsx --env-file=.env scripts/b/run-intake.ts`);
