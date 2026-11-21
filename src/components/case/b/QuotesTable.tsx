import Link from "next/link";
import { admin } from "@/lib/supabase";
import { fmtDate, fmtINR } from "@/quotes/format";
import { Badge, Flags, s, statusTone } from "./ui";

/** Quotes on a case, newest version per vendor first. Server component; mounted on /dev/quotes and later the case Quotes tab. */
export async function QuotesTable({ caseId, reviewHref = (id: string) => `/dev/quotes/${id}` }: { caseId: string; reviewHref?: (quoteId: string) => string }) {
  const db = admin();
  const { data: quotes } = await db.from("quotes")
    .select("id,vendor_id,version,status,quote_date,total_on_boq,vendor_total,comparable_lines,scope,flags,needs_review,review_reasons,error,created_at")
    .eq("case_id", caseId).order("created_at", { ascending: false });
  const vendorIds = [...new Set((quotes ?? []).map((q: any) => q.vendor_id))];
  const { data: vendors } = vendorIds.length ? await db.from("vendors").select("id,name").in("id", vendorIds) : { data: [] };
  const name = (id: string) => vendors?.find((v: any) => v.id === id)?.name ?? id.slice(0, 8);
  if (!quotes?.length) return <p style={s.muted}>No quotes on this case yet.</p>;
  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th}>Vendor</th><th style={s.th}>Ver.</th><th style={s.th}>Status</th><th style={s.th}>Dated</th>
          <th style={{ ...s.th, ...s.num }}>On Vinayak's quantities</th><th style={{ ...s.th, ...s.num }}>As the vendor priced it</th>
          <th style={s.th}>Flags</th><th style={s.th}></th>
        </tr>
      </thead>
      <tbody>
        {quotes.map((q: any) => (
          <tr key={q.id} style={q.status === "superseded" ? { opacity: 0.5 } : undefined}>
            <td style={s.td}>{name(q.vendor_id)}</td>
            <td style={s.td}>v{q.version}</td>
            <td style={s.td}>
              <Badge tone={statusTone(q.status)}>{q.status.replace("_", " ")}</Badge>
              {q.error && <div style={{ ...s.muted, color: "#991b1b" }}>{q.error}</div>}
            </td>
            <td style={s.td}>{fmtDate(q.quote_date)}</td>
            <td style={{ ...s.td, ...s.num }}>
              {fmtINR(q.total_on_boq)}
              {q.comparable_lines != null && <div style={s.muted}>{q.comparable_lines} lines comparable</div>}
            </td>
            <td style={{ ...s.td, ...s.num }}>{fmtINR(q.vendor_total)}</td>
            <td style={s.td}><Flags flags={q.flags ?? []} hideInfo /></td>
            <td style={s.td}>{q.status !== "extracting" && <Link href={reviewHref(q.id)}>{q.needs_review ? "Review" : "Open"}</Link>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
