/**
 * Search check on the Amara case: each question has the quote page that answers it.
 * A question passes when that page is in the top 3 hits.
 *
 * Usage: npm run eval:search -- [--no-translate | --translate-only] [case_id]
 * Default: run each question twice, without and with query translation, and print both.
 * Exit code 1 when a Bengali question misses in the last mode that ran.
 * Run `npm run index:docs` first.
 */
import { admin } from "@/lib/supabase";
import { searchWithInfo, type SearchHit } from "@/search/hybrid";

const AMARA_CASE = "37b762dc-2e9f-4dde-a7ff-f2a20a3dc7f4";
const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith("--")) ?? AMARA_CASE;
const modes: boolean[] = args.includes("--no-translate") ? [false] : args.includes("--translate-only") ? [true] : [false, true];

type Lang = "en" | "bn" | "hi";
interface Expect { file: string; page?: number }
interface Case { lang: Lang; q: string; note: string; expect: Expect[] }

// Facts come from the text of the four quotes (checked by hand on the PDFs).
const CASES: Case[] = [
  { lang: "en", q: "Which vendor gives a 10 year warranty on stamp paper?", note: "Bajrang T&C 16", expect: [{ file: "Quotation_Bajrang_Construction.pdf", page: 6 }] },
  { lang: "en", q: "RA bill paid within 7 days", note: "Purvyakruti T&C 7", expect: [{ file: "Quotation_Purvyakruti.pdf", page: 4 }] },
  { lang: "en", q: "S.K. Construction handwritten rate for toilet floor", note: "SK scan, rate 34 from the quote reading", expect: [{ file: "Quotation_SK_Construction.pdf", page: 1 }] },
  { lang: "bn", q: "কোন ভেন্ডর ১০ বছরের ওয়ারেন্টি দিচ্ছে?", note: "Which vendor gives a 10-year warranty? -> Bajrang", expect: [{ file: "Quotation_Bajrang_Construction.pdf", page: 6 }] },
  { lang: "bn", q: "কোন ভেন্ডরের রানিং বিল সাত দিনের মধ্যে পেমেন্ট করতে হবে?", note: "Whose RA bill is paid in 7 days? -> Purvyakruti", expect: [{ file: "Quotation_Purvyakruti.pdf", page: 4 }] },
  { lang: "bn", q: "পেমেন্ট দেরি হলে কত শতাংশ সুদ দিতে হবে?", note: "Interest on late payment? -> Bajrang 18% p.a.", expect: [{ file: "Quotation_Bajrang_Construction.pdf", page: 6 }] },
  { lang: "bn", q: "অর্ডার পাওয়ার কত দিনের মধ্যে কাজ শুরু করা যাবে?", note: "Start within how many days of the order? -> Bajrang 14 days", expect: [{ file: "Quotation_Bajrang_Construction.pdf", page: 6 }] },
  { lang: "bn", q: "কোন ভেন্ডর CICO আর FOSROC ব্র্যান্ডের কেমিক্যাল ব্যবহার করবে?", note: "Which vendor names CICO and FOSROC chemicals? -> Shyama", expect: [{ file: "Quotation_Shyama.pdf", page: 5 }] },
  { lang: "bn", q: "কোন ভেন্ডর সাইটে মাল আসার পর ৫০% অগ্রিম চায়?", note: "Who asks a 50% advance against material at site? -> Purvyakruti", expect: [{ file: "Quotation_Purvyakruti.pdf", page: 4 }] },
  { lang: "hi", q: "किस वेंडर ने कहा कि भुगतान की शर्तें बातचीत के बाद तय होंगी?", note: "Payment terms fixed after discussion -> Shyama", expect: [{ file: "Quotation_Shyama.pdf", page: 5 }] },
];

const { data: docs } = await admin().from("documents").select("id,filename").eq("case_id", caseId);
const fileOf = new Map((docs ?? []).map((d) => [d.id as string, d.filename as string]));
const short = (f: string) => f.replace(/^Quotation_/, "").replace(/\.pdf$/, "");

const matches = (h: SearchHit, e: Expect) => fileOf.get(h.document_id ?? "") === e.file && (e.page == null || h.page === e.page);

let lastBengaliMisses = 0;
for (const translate of modes) {
  console.log(`\n================ ${translate ? "WITH" : "WITHOUT"} query translation ================`);
  const tally: Record<Lang, [number, number]> = { en: [0, 0], bn: [0, 0], hi: [0, 0] };
  for (const c of CASES) {
    const started = Date.now();
    const { hits, translation } = await searchWithInfo(c.q, { caseId, limit: 10, translate });
    const top = hits.slice(0, 3);
    const rank = hits.findIndex((h) => c.expect.some((e) => matches(h, e)));
    const pass = rank >= 0 && rank < 3;
    tally[c.lang][1]++;
    if (pass) tally[c.lang][0]++;
    console.log(`\n[${pass ? "PASS" : "FAIL"}] (${c.lang}) ${c.q}`);
    console.log(`       expect ${c.expect.map((e) => `${short(e.file)} p${e.page ?? "*"}`).join(" or ")}  |  ${c.note}  |  rank ${rank >= 0 ? rank + 1 : "-"}  |  ${Date.now() - started} ms`);
    if (translation) console.log(`       also searched: "${translation}"`);
    top.forEach((h, i) => {
      const src = h.document_id ? `${short(fileOf.get(h.document_id) ?? h.document_id)} p${h.page ?? "-"}` : `message ${h.message_id}`;
      const v = h.vector_score == null ? "  -  " : h.vector_score.toFixed(3);
      const k = h.keyword_score == null ? "  -  " : h.keyword_score.toFixed(3);
      console.log(`       ${i + 1}. ${src.padEnd(28)} score ${h.score.toFixed(4)} vec ${v} kw ${k}  ${h.text.slice(0, 90).replace(/\s+/g, " ")}`);
    });
  }
  const line = (Object.keys(tally) as Lang[]).map((l) => `${l} ${tally[l][0]}/${tally[l][1]}`).join(", ");
  console.log(`\nSummary ${translate ? "with" : "without"} translation: ${line}`);
  lastBengaliMisses = tally.bn[1] - tally.bn[0];
}
process.exit(lastBengaliMisses > 0 ? 1 : 0);
