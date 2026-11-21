import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { searchWithInfo, keywordTerms, type SearchHit } from "@/search/hybrid";
import { snippetAround } from "@/search/snippet";
import { documentPageUrl } from "@/quotes/source";
import { Badge, s } from "@/components/case/b/ui";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrUndefined = (v?: string) => (v && UUID.test(v) ? v : undefined);

interface SourceInfo {
  label: string;
  detail: string | null;
  href: string | null;
  external: boolean;
  vendor: string | null;
}

/** Labels and links for each hit: the vendor and file name with the page, or the message subject and sender. */
async function describe(hits: SearchHit[]): Promise<Map<string, SourceInfo>> {
  const db = admin();
  const docIds = [...new Set(hits.map((h) => h.document_id).filter(Boolean))] as string[];
  const msgIds = [...new Set(hits.map((h) => h.message_id).filter((id, i) => id && !hits[i].document_id))] as string[];
  const [{ data: docs }, { data: quotes }, { data: msgs }, { data: chunkMeta }] = await Promise.all([
    docIds.length ? db.from("documents").select("id,filename,case_id").in("id", docIds) : Promise.resolve({ data: [] as any[] }),
    docIds.length
      ? db.from("quotes").select("id,document_id,vendor_id,version").in("document_id", docIds).neq("status", "superseded").order("version", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    msgIds.length ? db.from("messages").select("id,subject,sender,channel,case_id").in("id", msgIds) : Promise.resolve({ data: [] as any[] }),
    db.from("doc_chunks").select("id,vendor_id").in("id", hits.map((h) => h.id)),
  ]);
  const vendorIds = [...new Set([...(quotes ?? []).map((q: any) => q.vendor_id), ...(chunkMeta ?? []).map((c: any) => c.vendor_id)].filter(Boolean))];
  const { data: vendors } = vendorIds.length ? await db.from("vendors").select("id,name").in("id", vendorIds) : { data: [] as any[] };

  const docById = new Map((docs ?? []).map((d: any) => [d.id, d]));
  const quoteByDoc = new Map<string, any>();
  for (const q of quotes ?? []) if (!quoteByDoc.has(q.document_id)) quoteByDoc.set(q.document_id, q);
  const msgById = new Map((msgs ?? []).map((m: any) => [m.id, m]));
  const vendorName = new Map((vendors ?? []).map((v: any) => [v.id, v.name as string]));
  const chunkVendor = new Map((chunkMeta ?? []).map((c: any) => [c.id, c.vendor_id as string | null]));

  // The evidence viewer lives under /dev until the case workspace mounts it, so in production use a signed link to the PDF.
  const viewer = process.env.NODE_ENV !== "production";
  const signed = new Map<string, string | null>();
  for (const id of docIds) if (!(viewer && quoteByDoc.has(id))) signed.set(id, await documentPageUrl(id).catch(() => null));

  const out = new Map<string, SourceInfo>();
  for (const h of hits) {
    const vendorId = chunkVendor.get(h.id) ?? null;
    const vendor = vendorId ? vendorName.get(vendorId) ?? null : null;
    if (h.document_id) {
      const d = docById.get(h.document_id);
      const q = quoteByDoc.get(h.document_id);
      const page = h.page ? `page ${h.page}` : null;
      let href: string | null = null;
      let external = false;
      if (viewer && q) href = `/dev/quotes/${q.id}${h.page ? `?page=${h.page}` : ""}`;
      else {
        const url = signed.get(h.document_id);
        if (url) {
          href = h.page ? `${url}#page=${h.page}` : url;
          external = true;
        }
      }
      out.set(h.id, { label: d?.filename ?? "Document", detail: page, href, external, vendor });
    } else {
      const m = msgById.get(h.message_id ?? "");
      const detail = m ? [m.channel, m.sender].filter(Boolean).join(" from ") : null;
      out.set(h.id, { label: m?.subject || "Message", detail, href: m?.case_id ? `/cases/${m.case_id}` : null, external: false, vendor });
    }
  }
  return out;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; case?: string; vendor?: string }> }) {
  await requirePageUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 300);
  const caseId = uuidOrUndefined(sp.case);
  const vendorId = uuidOrUndefined(sp.vendor);
  const db = admin();

  const [{ data: cases }, { data: vendors }] = await Promise.all([
    db.from("cases").select("id,title").order("created_at", { ascending: false }).limit(50),
    db.from("vendors").select("id,name").order("name").limit(500),
  ]);

  let result: Awaited<ReturnType<typeof searchWithInfo>> | null = null;
  let error: string | null = null;
  if (q) {
    try {
      result = await searchWithInfo(q, { caseId, vendorId, limit: 15 });
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const info = result ? await describe(result.hits) : new Map<string, SourceInfo>();
  const terms = [...keywordTerms(q), ...keywordTerms(result?.translation ?? "")];

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Search</h1>
      <p style={s.muted}>Searches quotes, tender documents and messages by meaning and by keyword. Ask in English, Bengali or Hindi.</p>
      <form action="/search" method="get" role="search" style={{ ...s.card, display: "grid", gap: 8 }}>
        <input
          type="search" name="q" defaultValue={q} required aria-label="Search question"
          placeholder="Who quoted a 10-year warranty? / কে ১০ বছরের ওয়ারেন্টি দিয়েছে?"
          style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 15, minWidth: 0 }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={s.muted}>Case{" "}
            <select name="case" defaultValue={caseId ?? ""} style={{ maxWidth: 260 }}>
              <option value="">All cases</option>
              {(cases ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label style={s.muted}>Vendor{" "}
            <select name="vendor" defaultValue={vendorId ?? ""} style={{ maxWidth: 260 }}>
              <option value="">All vendors</option>
              {(vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <button type="submit" style={s.primary}>Search</button>
        </div>
      </form>

      {error && <p style={{ color: "#991b1b" }}>Search failed: {error}</p>}
      {result?.translation && (
        <p style={s.muted}>Also searched the English translation: <em>{result.translation}</em></p>
      )}
      {result && result.hits.length === 0 && <p>No passage matches. Try other words, or remove the case or vendor filter.</p>}

      {result && result.hits.length > 0 && (
        <ol style={{ paddingLeft: 20 }}>
          {result.hits.map((h) => {
            const src = info.get(h.id);
            const title = (
              <>
                {src?.label}
                {src?.detail ? `, ${src.detail}` : ""}
              </>
            );
            return (
              <li key={h.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
                  {src?.vendor && <Badge tone="info">{src.vendor}</Badge>}
                  <Badge>{h.source_type === "message" ? "Message" : "Document"}</Badge>
                  {src?.href ? (
                    src.external ? <a href={src.href} target="_blank" rel="noreferrer">{title}</a> : <Link href={src.href}>{title}</Link>
                  ) : (
                    <span>{title}</span>
                  )}
                  <span style={s.muted} title={`vector ${h.vector_score?.toFixed(3) ?? "-"}, keyword ${h.keyword_score?.toFixed(3) ?? "-"}`}>
                    score {h.score.toFixed(4)}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#333", marginTop: 4, overflowWrap: "anywhere" }}>{snippetAround(h.text, terms)}</div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
