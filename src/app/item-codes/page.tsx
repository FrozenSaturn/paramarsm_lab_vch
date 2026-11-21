import { admin } from "@/lib/supabase";
import { requirePageUser } from "@/lib/auth";
import { hygieneReport, type CodeRow } from "@/erp/hygiene";
export const dynamic = "force-dynamic";

const serials = (s: (number | null)[]) => s.map(x => `#${x ?? "?"}`).join(", ");

export default async function ItemCodes() {
  await requirePageUser();
  const { data } = await admin().from("item_codes").select("id,code,description,erp_serial").order("erp_serial");
  const rows = (data ?? []) as CodeRow[];
  const r = hygieneReport(rows);
  return (
    <>
      <h1>Item codes</h1>
      <p>{r.totals.rows} rows in the ERP mirror, {r.totals.distinctCodes} different codes. This report is computed by code from the rows. Nothing here changes the ERP.</p>

      <h2>Code with two meanings ({r.codeConflicts.length})</h2>
      <ul>{r.codeConflicts.map(c => <li key={c.code}><b>{c.code}</b>: {c.meanings.map(m => `"${m.description}" (${serials(m.serials)})`).join("  vs  ")}</li>)}</ul>

      <h2>Same meaning under different codes ({r.sameMeaningDifferentCodes.length})</h2>
      <ul>{r.sameMeaningDifferentCodes.map(s => <li key={s.description}>"{s.description}": {s.codes.map(c => `${c.code} (#${c.serial})`).join(", ")}</li>)}</ul>

      <h2>Listed twice with the same meaning ({r.exactDuplicates.length})</h2>
      <ul>{r.exactDuplicates.map(d => <li key={d.code}><b>{d.code}</b> ({serials(d.serials)}): {d.description}</li>)}</ul>

      <h2>Different spellings of one code ({r.formatVariants.length})</h2>
      <ul>{r.formatVariants.map(v => <li key={v.key}>{v.codes.join("  /  ")}</li>)}</ul>

      <h2>Close descriptions under different codes ({r.nearDuplicates.length})</h2>
      <ul>{r.nearDuplicates.slice(0, 40).map(n => <li key={n.a.id + n.b.id}>{n.similarity}: {n.a.code} "{n.a.description}"  ~  {n.b.code} "{n.b.description}"</li>)}</ul>

      <h2>Format problems ({r.formatAnomalies.length})</h2>
      <ul>{r.formatAnomalies.map((a, i) => <li key={i}>{a.code} (#{a.serial}): {a.problem}</li>)}</ul>
    </>
  );
}
