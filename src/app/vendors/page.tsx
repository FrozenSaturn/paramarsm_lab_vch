import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { DemoBadge } from "@/components/case/b/DemoBadge";
import { Badge, s } from "@/components/case/b/ui";
export const dynamic = "force-dynamic";

/** Counts rows per vendor_id. */
function countBy(rows: { vendor_id: string }[] | null) {
  const out = new Map<string, number>();
  for (const r of rows ?? []) out.set(r.vendor_id, (out.get(r.vendor_id) ?? 0) + 1);
  return out;
}

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePageUser();
  const { q = "" } = await searchParams;
  const db = admin();
  let query = db.from("vendors").select("id,name,is_demo,source,vendor_categories(category,inferred)").order("name").limit(500);
  const term = q.trim().replace(/[%_,()]/g, " ");
  if (term) query = query.ilike("name", `%${term}%`);
  const { data: vendors, error } = await query;
  const ids = (vendors ?? []).map((v: any) => v.id as string);
  const [{ data: quotes }, { data: perf }] = await Promise.all([
    ids.length ? db.from("quotes").select("vendor_id").in("vendor_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? db.from("vendor_performance").select("vendor_id").in("vendor_id", ids) : Promise.resolve({ data: [] as any[] }),
  ]);
  const quoteCount = countBy(quotes as any);
  const perfCount = countBy(perf as any);

  return (
    <main style={{ padding: 16, maxWidth: 1100 }}>
      <h1>Vendors</h1>
      <form method="get" style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
        <input type="search" name="q" defaultValue={q} placeholder="Filter by name" aria-label="Filter vendors by name"
          style={{ flex: 1, minWidth: 0, padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }} />
        <button type="submit" style={s.primary}>Filter</button>
        {q && <Link href="/vendors" style={{ alignSelf: "center" }}>Clear</Link>}
      </form>
      {error && <p style={{ color: "#991b1b" }}>Vendor read failed: {error.message}</p>}
      <p style={s.muted}>{vendors?.length ?? 0} vendors</p>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Name</th><th style={s.th}>Categories</th>
            <th style={{ ...s.th, ...s.num }}>Quotes</th><th style={{ ...s.th, ...s.num }}>Ratings</th>
          </tr>
        </thead>
        <tbody>
          {(vendors ?? []).map((v: any) => (
            <tr key={v.id}>
              <td style={s.td}>
                <Link href={`/vendors/${v.id}`}>{v.name}</Link>
                <DemoBadge show={v.is_demo === true} />
              </td>
              <td style={s.td}>
                {(v.vendor_categories ?? []).map((c: any, i: number) => (
                  <Badge key={i} tone={c.inferred ? "plain" : "info"} title={c.inferred ? "Inferred from the name" : undefined}>
                    {c.category}{c.inferred ? "?" : ""}
                  </Badge>
                ))}
              </td>
              <td style={{ ...s.td, ...s.num }}>{quoteCount.get(v.id) ?? 0}</td>
              <td style={{ ...s.td, ...s.num }}>{perfCount.get(v.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
