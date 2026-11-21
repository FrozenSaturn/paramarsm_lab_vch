import { admin } from "../lib/supabase";
import { embed } from "../lib/embeddings";
import { normCode, normDesc } from "../erp/hygiene";
import { cleanDesc } from "./attributes";

export interface Candidate { id: string; code: string; description: string; erp_serial: number | null; embScore: number | null; trigramScore: number | null }

/** Ten closest master codes by meaning and ten by spelling, merged by row. Plus every master row that carries the site's own code. */
export async function findCandidates(description: string, siteCode: string | null): Promise<{ candidates: Candidate[]; siteCodeRows: Candidate[] }> {
  const db = admin();
  const q = cleanDesc(description).toLowerCase();
  const [[vec]] = await Promise.all([embed([q], "query")]);
  const [byEmb, byTri] = await Promise.all([
    db.rpc("match_item_codes_by_embedding", { q: `[${vec.join(",")}]`, n: 10 }),
    db.rpc("match_item_codes_by_trigram", { q, n: 10 }),
  ]);
  if (byEmb.error) throw byEmb.error;
  if (byTri.error) throw byTri.error;
  const map = new Map<string, Candidate>();
  const put = (r: any, kind: "embScore" | "trigramScore") => {
    const c = map.get(r.id) ?? { id: r.id, code: r.code, description: r.description, erp_serial: r.erp_serial, embScore: null, trigramScore: null };
    c[kind] = r.score; map.set(r.id, c);
  };
  byEmb.data.forEach((r: any) => put(r, "embScore"));
  byTri.data.forEach((r: any) => put(r, "trigramScore"));
  let siteCodeRows: Candidate[] = [];
  if (siteCode) {
    const { data } = await db.from("item_codes").select("id,code,description,erp_serial").ilike("code", siteCode.replace(/[%_\\]/g, m => "\\" + m));
    siteCodeRows = (data ?? []).filter(r => normCode(r.code) === normCode(siteCode)).map(r => ({ ...r, embScore: null, trigramScore: null }));
  }
  return { candidates: [...map.values()], siteCodeRows };
}

/** A confirmed alias maps the same site wording to the same code at once. */
export async function aliasFor(description: string) {
  const { data } = await admin().from("code_aliases").select("item_code_id, item_codes!inner(id,code,description,erp_serial)").eq("alias_text", normDesc(description)).limit(1).maybeSingle();
  return data ? ((data as any).item_codes as { id: string; code: string; description: string; erp_serial: number | null }) : null;
}
