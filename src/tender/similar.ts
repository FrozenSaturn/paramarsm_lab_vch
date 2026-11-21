import { admin } from "../lib/supabase";
import { normCode, similarity } from "../erp/hygiene";

export interface SimilarTender { rfqRef: string; caseTitle: string; status: string | null; sentOn: string | null; quotesIn: number; score: number; reasons: string[] }

/** Duplicate-tender alert. Compares this case with other cases that have an RFQ: same project, overlapping item codes,
 *  similar quantities and similar line wording. It warns. It never blocks. */
export async function findSimilarTenders(caseId: string, windowDays = 365): Promise<SimilarTender[]> {
  const db = admin();
  const { data: me } = await db.from("cases").select("id, project_id").eq("id", caseId).single();
  const mine = await linesOf(caseId);
  if (!me || !mine.length) return [];
  const since = new Date(Date.now() - windowDays * 864e5).toISOString();
  const { data: rfqs } = await db.from("rfqs").select("id, ref, status, case_id, created_at, cases!inner(title, project_id)").neq("case_id", caseId).gte("created_at", since);
  const out: SimilarTender[] = [];
  for (const r of rfqs ?? []) {
    const theirs = await linesOf(r.case_id as string);
    if (!theirs.length) continue;
    const reasons: string[] = [];
    const codes = new Set(mine.map(l => l.code).filter(Boolean)), their = new Set(theirs.map(l => l.code).filter(Boolean));
    const shared = [...codes].filter(c => their.has(c));
    const jaccard = codes.size || their.size ? shared.length / new Set([...codes, ...their]).size : 0;
    if (shared.length) reasons.push(`${shared.length} shared item code(s): ${shared.slice(0, 4).join(", ")}`);
    const close = shared.filter(c => { const a = mine.find(l => l.code === c)!.qty, b = theirs.find(l => l.code === c)!.qty; return a && b && Math.abs(a - b) / Math.max(a, b) <= 0.2; });
    if (close.length) reasons.push(`quantities within 20% on ${close.length} of them`);
    // Same meaning in the lines, even if the codes differ.
    const wording = mine.map(m => Math.max(0, ...theirs.map(t => similarity(m.desc, t.desc)))).reduce((s, x) => s + x, 0) / mine.length;
    if (wording >= 0.7) reasons.push(`line wording is ${Math.round(wording * 100)}% alike`);
    const sameProject = !!me.project_id && me.project_id === (r as any).cases.project_id;
    if (sameProject) reasons.push("same project");
    const score = Math.round((0.45 * jaccard + 0.3 * wording + 0.15 * (close.length / Math.max(1, shared.length || 1)) + (sameProject ? 0.1 : 0)) * 100) / 100;
    if (score < 0.35 || !reasons.length) continue;
    const [{ data: rr }, { count }] = await Promise.all([
      db.from("rfq_recipients").select("sent_at").eq("rfq_id", r.id).not("sent_at", "is", null).order("sent_at").limit(1),
      db.from("quotes").select("id", { count: "exact", head: true }).eq("rfq_id", r.id),
    ]);
    out.push({ rfqRef: r.ref as string, caseTitle: (r as any).cases.title, status: r.status as string | null, sentOn: rr?.[0]?.sent_at ?? null, quotesIn: count ?? 0, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function linesOf(caseId: string) {
  const db = admin();
  const { data: v } = await db.from("boq_versions").select("id").eq("case_id", caseId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!v) return [];
  const { data: ls } = await db.from("boq_lines").select("description, quantity, item_code").eq("boq_version_id", v.id);
  return (ls ?? []).map(l => ({ desc: l.description as string, qty: l.quantity == null ? null : Number(l.quantity), code: l.item_code ? normCode(l.item_code) : null }));
}
