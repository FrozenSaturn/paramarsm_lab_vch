import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { isUuid } from "@/memory";
import { fmtDate, fmtINR } from "@/quotes/format";
import { DemoBadge, isDemoRow } from "@/components/case/b/DemoBadge";
import { MemoryPanel } from "@/components/case/b/MemoryPanel";
import { SearchBox } from "@/components/case/b/SearchBox";
import { VendorActionButtons } from "@/components/case/b/VendorActionButtons";
import { Badge, s, statusTone } from "@/components/case/b/ui";
export const dynamic = "force-dynamic";

const DIMS = ["quality", "timeliness", "disputes", "safety"] as const;

/** The mean of the rated values, or null when none. */
function mean(rows: any[], key: string): { avg: number | null; n: number } {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === "number") as number[];
  return { avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length };
}

const show = (v: unknown) => (v == null ? "—" : String(v));

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = admin();
  const { data: vendor } = await db.from("vendors").select("id,name,gstin,address,is_demo,source").eq("id", id).maybeSingle();
  if (!vendor) notFound();

  const [{ data: contacts }, { data: cats }, { data: perf }, { data: recips }, { data: quotes }, { data: pending }] = await Promise.all([
    db.from("vendor_contacts").select("id,name,email,phone").eq("vendor_id", id),
    db.from("vendor_categories").select("category,inferred").eq("vendor_id", id),
    db.from("vendor_performance").select("id,case_id,quality,timeliness,disputes,safety,note,source,is_demo,created_at").eq("vendor_id", id).order("created_at", { ascending: false }),
    db.from("rfq_recipients").select("id,rfq_id,email,sent_at,reminders_sent,status").eq("vendor_id", id),
    db.from("quotes").select("id,case_id,version,quote_date,total_on_boq,scope,status,created_at").eq("vendor_id", id).order("created_at", { ascending: false }),
    db.from("actions").select("id,case_id,status,payload,proposed_by,created_at").eq("kind", "performance_record").in("status", ["proposed", "edited"]).eq("payload->>vendor_id", id).order("created_at", { ascending: false }),
  ]);

  // RFQ refs and case titles for the tables.
  const rfqIds = [...new Set((recips ?? []).map((r: any) => r.rfq_id))];
  const { data: rfqs } = rfqIds.length ? await db.from("rfqs").select("id,ref,case_id,status").in("id", rfqIds) : { data: [] as any[] };
  const caseIds = [...new Set([
    ...(perf ?? []).map((r: any) => r.case_id), ...(quotes ?? []).map((r: any) => r.case_id),
    ...(rfqs ?? []).map((r: any) => r.case_id), ...(pending ?? []).map((r: any) => r.case_id),
  ].filter(Boolean))] as string[];
  const { data: cases } = caseIds.length ? await db.from("cases").select("id,title").in("id", caseIds) : { data: [] as any[] };
  const caseLink = (cid: string | null) => {
    if (!cid) return <span style={s.muted}>—</span>;
    const c = (cases ?? []).find((x: any) => x.id === cid);
    return <Link href={`/cases/${cid}`}>{c?.title ?? cid.slice(0, 8)}</Link>;
  };
  const rfq = (rid: string) => (rfqs ?? []).find((x: any) => x.id === rid);
  const perfRows = perf ?? [];
  const path = `/vendors/${id}`;

  return (
    <main style={{ padding: 16, maxWidth: 1100 }}>
      <p style={s.muted}><Link href="/vendors">← Vendors</Link></p>
      <h1 style={{ marginBottom: 4 }}>{vendor.name}<DemoBadge show={vendor.is_demo === true} /></h1>
      <div style={{ marginBottom: 12 }}>
        {(cats ?? []).map((c: any, i: number) => (
          <Badge key={i} tone={c.inferred ? "plain" : "info"} title={c.inferred ? "Inferred from the name" : undefined}>{c.category}{c.inferred ? "?" : ""}</Badge>
        ))}
      </div>

      <SearchBox vendorId={id} />

      <section style={s.card}>
        <h3 style={{ marginTop: 0 }}>Profile</h3>
        <div><strong>GSTIN:</strong> {vendor.gstin || <span style={s.muted}>not known</span>}</div>
        <div><strong>Address:</strong> {vendor.address || <span style={s.muted}>not known</span>}</div>
        {vendor.source && <div style={s.muted}>Source: {vendor.source}</div>}
        <h4>Contacts</h4>
        {contacts?.length ? (
          <table style={s.table}>
            <thead><tr><th style={s.th}>Name</th><th style={s.th}>Email</th><th style={s.th}>Phone</th></tr></thead>
            <tbody>
              {contacts.map((c: any) => (
                <tr key={c.id}><td style={s.td}>{show(c.name)}</td><td style={s.td}>{show(c.email)}</td><td style={s.td}>{show(c.phone)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p style={s.muted}>No contacts.</p>}
      </section>

      <section style={s.card}>
        <h3 style={{ marginTop: 0 }}>Scorecard</h3>
        <p style={s.muted}>Ratings are 1 to 5. 5 is best. A rating is written only after a person approves it.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {DIMS.map((d) => {
            const m = mean(perfRows, d);
            return (
              <div key={d} style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 12px", minWidth: 120 }}>
                <div style={s.muted}>{d}</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{m.avg == null ? "—" : m.avg.toFixed(1)}</div>
                <div style={s.muted}>{m.n} rating{m.n === 1 ? "" : "s"}</div>
              </div>
            );
          })}
        </div>
        {perfRows.length ? (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Date</th><th style={s.th}>Case</th>
                {DIMS.map((d) => <th key={d} style={{ ...s.th, ...s.num }}>{d}</th>)}
                <th style={s.th}>Note</th><th style={s.th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {perfRows.map((r: any) => (
                <tr key={r.id}>
                  <td style={s.td}>{fmtDate(r.created_at)}</td>
                  <td style={s.td}>{caseLink(r.case_id)}</td>
                  {DIMS.map((d) => <td key={d} style={{ ...s.td, ...s.num }}>{show(r[d])}</td>)}
                  <td style={s.td}>{r.note ?? ""}</td>
                  <td style={s.td}>{r.source ?? "—"}<DemoBadge show={isDemoRow(r)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={s.muted}>No ratings yet.</p>}
      </section>

      <section style={s.card}>
        <h3 style={{ marginTop: 0 }}>Proposed ratings</h3>
        {pending?.length ? pending.map((a: any) => {
          const p = a.payload ?? {};
          return (
            <div key={a.id} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
              <div>
                {DIMS.map((d) => <Badge key={d} tone={p[d] == null ? "plain" : "info"}>{d}: {show(p[d])}</Badge>)}
                <Badge tone="warn">{a.status}</Badge>
              </div>
              {p.note && <div style={{ marginTop: 4 }}>{p.note}</div>}
              {p.evidence && <blockquote style={{ margin: "4px 0", paddingLeft: 8, borderLeft: "3px solid #ddd", color: "#444" }}>{p.evidence}</blockquote>}
              <div style={s.muted}>{fmtDate(a.created_at)} · case {caseLink(a.case_id)} · by {a.proposed_by ?? "unknown"}</div>
              <div style={{ marginTop: 6 }}><VendorActionButtons actionId={a.id} /></div>
            </div>
          );
        }) : <p style={s.muted}>No ratings wait for approval.</p>}
      </section>

      <section style={s.card}>
        <h3 style={{ marginTop: 0 }}>RFQs sent</h3>
        {recips?.length ? (
          <table style={s.table}>
            <thead><tr><th style={s.th}>Ref</th><th style={s.th}>Case</th><th style={s.th}>Sent</th><th style={{ ...s.th, ...s.num }}>Reminders</th><th style={s.th}>Status</th></tr></thead>
            <tbody>
              {recips.map((r: any) => {
                const x = rfq(r.rfq_id);
                return (
                  <tr key={r.id}>
                    <td style={s.td}>{x?.ref ?? r.rfq_id.slice(0, 8)}</td>
                    <td style={s.td}>{caseLink(x?.case_id ?? null)}</td>
                    <td style={s.td}>{fmtDate(r.sent_at)}</td>
                    <td style={{ ...s.td, ...s.num }}>{r.reminders_sent ?? 0}</td>
                    <td style={s.td}><Badge>{r.status ?? "—"}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p style={s.muted}>No RFQs sent to this vendor.</p>}
      </section>

      <section style={s.card}>
        <h3 style={{ marginTop: 0 }}>Quotes</h3>
        {quotes?.length ? (
          <table style={s.table}>
            <thead><tr><th style={s.th}>Case</th><th style={s.th}>Ver.</th><th style={s.th}>Dated</th><th style={{ ...s.th, ...s.num }}>On BOQ quantities</th><th style={s.th}>Scope</th><th style={s.th}>Status</th><th style={s.th}></th></tr></thead>
            <tbody>
              {quotes.map((q: any) => (
                <tr key={q.id} style={q.status === "superseded" ? { opacity: 0.5 } : undefined}>
                  <td style={s.td}>{caseLink(q.case_id)}</td>
                  <td style={s.td}>v{q.version}</td>
                  <td style={s.td}>{fmtDate(q.quote_date)}</td>
                  <td style={{ ...s.td, ...s.num }}>{fmtINR(q.total_on_boq == null ? null : Number(q.total_on_boq))}</td>
                  <td style={s.td}>{q.scope ?? "—"}</td>
                  <td style={s.td}><Badge tone={statusTone(q.status ?? "")}>{(q.status ?? "—").replace("_", " ")}</Badge></td>
                  <td style={s.td}><Link href={`/dev/quotes/${q.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={s.muted}>No quotes from this vendor.</p>}
      </section>

      <MemoryPanel entity={`vendor:${id}`} path={path} />
    </main>
  );
}
