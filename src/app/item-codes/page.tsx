import { admin } from "@/lib/supabase";
import { requirePageUser } from "@/lib/auth";
import { PageHead, Panel, Pill } from "@/components/ui";
import { hygieneReport, type CodeRow } from "@/erp/hygiene";
export const dynamic = "force-dynamic";

const serials = (s: (number | null)[]) => s.map(x => `#${x ?? "?"}`).join(", ");

export default async function ItemCodes() {
  await requirePageUser();
  const { data } = await admin().from("item_codes").select("id,code,description,erp_serial").order("erp_serial");
  const rows = (data ?? []) as CodeRow[];
  const r = hygieneReport(rows);
  const Section = ({ title, n, children }: { title: string; n: number; children: React.ReactNode }) => (
    <Panel title={title} meta={n}>{n ? children : <p className="muted" style={{ margin: 0 }}>None found.</p>}</Panel>
  );
  return (
    <>
      <PageHead title="Item codes" sub={`${r.totals.rows} rows in the ERP mirror, ${r.totals.distinctCodes} different codes. This report is computed by code from the rows. Nothing here changes the ERP.`} />
      <div className="stack">
        <Section title="Code with two meanings" n={r.codeConflicts.length}>
          <ul>{r.codeConflicts.map(c => <li key={c.code}><b className="mono">{c.code}</b>: {c.meanings.map(m => `"${m.description}" (${serials(m.serials)})`).join("  vs  ")}</li>)}</ul>
        </Section>
        <Section title="Same meaning under different codes" n={r.sameMeaningDifferentCodes.length}>
          <ul>{r.sameMeaningDifferentCodes.map(s => <li key={s.description}>"{s.description}": {s.codes.map(c => `${c.code} (#${c.serial})`).join(", ")}</li>)}</ul>
        </Section>
        <Section title="Listed twice with the same meaning" n={r.exactDuplicates.length}>
          <ul>{r.exactDuplicates.map(d => <li key={d.code}><b className="mono">{d.code}</b> ({serials(d.serials)}): {d.description}</li>)}</ul>
        </Section>
        <Section title="Different spellings of one code" n={r.formatVariants.length}>
          <ul>{r.formatVariants.map(v => <li key={v.key} className="mono">{v.codes.join("  /  ")}</li>)}</ul>
        </Section>
        <Section title="Close descriptions under different codes" n={r.nearDuplicates.length}>
          <ul>{r.nearDuplicates.slice(0, 40).map(n => <li key={n.a.id + n.b.id}><Pill tone="info">{n.similarity}</Pill> {n.a.code} "{n.a.description}" ~ {n.b.code} "{n.b.description}"</li>)}</ul>
        </Section>
        <Section title="Format problems" n={r.formatAnomalies.length}>
          <ul>{r.formatAnomalies.map((a, i) => <li key={i}><span className="mono">{a.code}</span> (#{a.serial}): {a.problem}</li>)}</ul>
        </Section>
      </div>
    </>
  );
}
