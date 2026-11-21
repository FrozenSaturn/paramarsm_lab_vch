/**
 * Made-up vendor performance ratings for the demo (PLAN.md section 12).
 *
 * The ratings are invented. They sit against real vendor names. Each row has
 * is_demo = true, source = 'demo' and a note that starts "Demo data (made up):".
 * The UI shows a "demo data" badge for these rows.
 *
 * The script is safe to run again. It deletes the demo rows of the four vendors first.
 *
 *   npm run seed:b-performance
 */
import { admin } from "../../../src/lib/supabase";

const VENDORS = ["Bajrang Construction & Waterproofing", "Purvyakruti", "Shyama", "S.K. Construction"] as const;
const CASES = { aquina: "Waterproofing - Aquina Block C (closed)", acres: "Waterproofing - 21 Acres Phase 2 (closed)" } as const;
const NOTE = "Demo data (made up):";

type Rating = { vendor: (typeof VENDORS)[number]; case: keyof typeof CASES; quality: number; timeliness: number; disputes: number; safety: number; note: string };

// Scale 1..5, 5 is best. For disputes, 5 means no disputes.
const RATINGS: Rating[] = [
  { vendor: "Bajrang Construction & Waterproofing", case: "aquina", quality: 4, timeliness: 2, disputes: 3, safety: 4, note: "finished 3 weeks late; one dispute on extra membrane quantity." },
  { vendor: "Bajrang Construction & Waterproofing", case: "acres", quality: 3, timeliness: 2, disputes: 3, safety: 3, note: "late again on the podium slab; rate dispute settled at site." },
  { vendor: "Purvyakruti", case: "aquina", quality: 5, timeliness: 5, disputes: 5, safety: 4, note: "finished on time; no leaks at the 6-month check." },
  { vendor: "Purvyakruti", case: "acres", quality: 5, timeliness: 4, disputes: 5, safety: 5, note: "good finish; one week late because of rain." },
  { vendor: "Shyama", case: "aquina", quality: 3, timeliness: 4, disputes: 4, safety: 2, note: "on time, but two safety observations for no harness." },
  { vendor: "Shyama", case: "acres", quality: 4, timeliness: 3, disputes: 4, safety: 3, note: "mixed result; touch-up needed on the terrace." },
  { vendor: "S.K. Construction", case: "acres", quality: 3, timeliness: 3, disputes: 4, safety: 3, note: "average work; no major issue." },
];

const db = admin();
const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };

const v = await db.from("vendors").select("id,name").in("name", [...VENDORS]);
fail("find vendors", v.error);
const vendorId = new Map((v.data ?? []).map((r) => [r.name as string, r.id as string]));
for (const n of VENDORS) if (!vendorId.has(n)) throw new Error(`No vendor named "${n}". Run npm run seed first.`);

const c = await db.from("cases").select("id,title").in("title", Object.values(CASES));
fail("find cases", c.error);
const caseId = new Map((c.data ?? []).map((r) => [r.title as string, r.id as string]));
for (const t of Object.values(CASES)) if (!caseId.has(t)) throw new Error(`No case titled "${t}". Run npm run seed first.`);

// Remove the old demo rows of these vendors. Confirmed and imported rows stay.
const del = await db.from("vendor_performance").delete().eq("source", "demo").in("vendor_id", [...vendorId.values()]).select("id");
fail("delete old demo rows", del.error);
console.log(`Deleted ${del.data?.length ?? 0} old demo rows.`);

const rows = RATINGS.map((r) => ({
  vendor_id: vendorId.get(r.vendor)!,
  case_id: caseId.get(CASES[r.case])!,
  quality: r.quality, timeliness: r.timeliness, disputes: r.disputes, safety: r.safety,
  note: `${NOTE} ${r.note}`,
  is_demo: true,
  source: "demo",
}));
const ins = await db.from("vendor_performance").insert(rows).select("id,vendor_id,case_id,quality,timeliness,disputes,safety,note");
fail("insert demo rows", ins.error);

const vendorName = new Map([...vendorId].map(([n, id]) => [id, n]));
const caseTitle = new Map([...caseId].map(([t, id]) => [id, t]));
console.log(`Inserted ${ins.data?.length ?? 0} demo rows into vendor_performance:`);
for (const r of ins.data ?? []) {
  console.log(`  ${vendorName.get(r.vendor_id)} | ${caseTitle.get(r.case_id)} | Q${r.quality} T${r.timeliness} D${r.disputes} S${r.safety} | ${r.note}`);
}
