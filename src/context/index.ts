/**
 * getContext(caseId, purpose): one bounded pack for an agent, from three sources.
 *
 *   facts     SQL rows: case, quotes, scores, RFQs, performance records, BOQ lines
 *   passages  hybrid search over doc_chunks (meaning and keywords), filtered to the case
 *   memories  mem0 (or memory_refs when mem0 is down), scoped to the case, its project and its vendors
 *
 * Every item carries a source_id ("<table>:<id>", a doc_chunks id, or a memory_refs id).
 * It never throws for a missing case. Memories and passages are optional: an error there
 * gives an empty list, and the facts still return.
 */
import type { ContextItem, ContextPack, GetContext } from "../contracts/context";
import { admin } from "@/lib/supabase";
import { hybridSearch } from "@/search/hybrid";
import { entity, isUuid, resilientSearch, withTimeout } from "@/memory";
import { LIMITS, bound, byScoreDesc, emptyPack, liveQuotes, mergeFacts, boqLineFact, performanceFact, quoteFact, rfqFact, scoreFact } from "./pack";

const fact = (text: string, source_id: string): ContextItem => ({ text, source_id, source_type: "fact" });
const num = (x: unknown) => (x == null || x === "" ? null : Number(x));

interface CaseFacts {
  facts: ContextItem[];
  projectId: string | null;
  vendorIds: string[];
}

async function loadFacts(caseId: string): Promise<CaseFacts | null> {
  const db = admin();
  const { data: c } = await db.from("cases").select("id,title,stage,status,project_id,created_at").eq("id", caseId).maybeSingle();
  if (!c) return null;

  const [project, versions, rfqs, quotes, comparative] = await Promise.all([
    c.project_id ? db.from("projects").select("name").eq("id", c.project_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("boq_versions").select("id,version,status").eq("case_id", caseId).order("version", { ascending: false }),
    db.from("rfqs").select("id,ref,status,due_date,created_at,rfq_recipients(vendor_id,sent_at,status)").eq("case_id", caseId).order("created_at", { ascending: false }),
    db.from("quotes").select("id,vendor_id,version,status,total_on_boq,comparable_lines,scope,quote_date,valid_until,payment_terms,completion_time,flags").eq("case_id", caseId),
    db.from("comparatives").select("*").eq("case_id", caseId).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const live = liveQuotes((quotes.data ?? []) as any[]);
  const recipients = (rfqs.data ?? []).flatMap((r: any) => r.rfq_recipients ?? []);
  const vendorIds = [...new Set([...live.map((q: any) => q.vendor_id), ...recipients.map((r: any) => r.vendor_id)].filter(isUuid))];

  const [vendors, perf, scores, lines] = await Promise.all([
    vendorIds.length ? db.from("vendors").select("id,name").in("id", vendorIds) : Promise.resolve({ data: [] as any[] }),
    vendorIds.length
      ? db.from("vendor_performance").select("id,vendor_id,quality,timeliness,disputes,safety,note,source,is_demo,created_at").in("vendor_id", vendorIds).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as any[] }),
    comparative.data ? db.from("scores").select("*").eq("comparative_id", comparative.data.id) : Promise.resolve({ data: [] as any[] }),
    (async () => {
      const v = (versions.data ?? []).find((x: any) => x.status === "accepted") ?? versions.data?.[0];
      if (!v) return { v: null, rows: [] as any[] };
      const { data } = await db.from("boq_lines").select("id,serial,description,unit,quantity,item_code").eq("boq_version_id", v.id);
      const rows = (data ?? []).sort((a: any, b: any) => String(a.serial).localeCompare(String(b.serial), undefined, { numeric: true }));
      return { v, rows };
    })(),
  ]);
  const name = new Map((vendors.data ?? []).map((v: any) => [v.id, v.name as string]));
  const vn = (id: string) => name.get(id) ?? `vendor ${id.slice(0, 8)}`;

  const caseGroup = [fact(
    `Case "${c.title}": stage ${c.stage}, status ${c.status}` + (project.data?.name ? `, project ${project.data.name}` : "") +
      `. ${live.length} live quote(s), ${vendorIds.length} vendor(s) invited or quoting.`,
    `cases:${c.id}`,
  )];

  // Lowest total on the BOQ first.
  const quoteGroup = byScoreDesc(live.map((q: any) => ({ ...q, score: -(num(q.total_on_boq) ?? Infinity) })))
    .map((q: any) => fact(quoteFact(q, vn(q.vendor_id)), `quotes:${q.id}`));

  const scoreGroup: ContextItem[] = [];
  if (comparative.data) {
    const cmp = comparative.data as any;
    const totals = cmp.matrix?.totals ?? {};
    const ranked = [...(scores.data ?? [])].sort((a: any, b: any) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (num(b.total) ?? 0) - (num(a.total) ?? 0));
    ranked.forEach((s: any, i: number) => {
      scoreGroup.push(fact(scoreFact({ rank: s.rank ?? i + 1, total: s.total }, vn(s.vendor_id), cmp.version, num(totals[s.vendor_id]?.landed)), `scores:${s.id}`));
    });
    if (!ranked.length) scoreGroup.push(fact(`Comparative v${cmp.version} exists, with no scores yet.`, `comparatives:${cmp.id}`));
  }

  const rfqGroup = (rfqs.data ?? []).map((r: any) =>
    fact(rfqFact(r, (r.rfq_recipients ?? []).map((x: any) => ({ name: vn(x.vendor_id), sent_at: x.sent_at, status: x.status }))), `rfqs:${r.id}`));

  const perfGroup = (perf.data ?? []).map((p: any) => fact(performanceFact(p, vn(p.vendor_id)), `vendor_performance:${p.id}`));

  const boqGroup = lines.v ? lines.rows.map((l: any) => fact(boqLineFact(l, lines.v as any), `boq_lines:${l.id}`)) : [];

  return {
    facts: mergeFacts([caseGroup, quoteGroup, scoreGroup, rfqGroup, perfGroup, boqGroup], LIMITS.facts),
    projectId: c.project_id ?? null,
    vendorIds,
  };
}

async function loadPassages(caseId: string, purpose: string): Promise<ContextItem[]> {
  if (!purpose.trim()) return [];
  // The first call can load the embedding model, so this timeout is longer than the others.
  const hits = await withTimeout(hybridSearch(purpose, { caseId, limit: LIMITS.passages }), 20000, "passage search");
  return hits.map((h) => ({ text: h.page != null ? `[p. ${h.page}] ${h.text}` : h.text, source_id: h.source_id, source_type: h.source_type }));
}

async function loadMemories(caseId: string, purpose: string, projectId: string | null, vendorIds: string[]): Promise<ContextItem[]> {
  if (!purpose.trim()) return [];
  const ents = [entity("case", caseId), ...(projectId ? [entity("project", projectId)] : []), ...vendorIds.map((v) => entity("vendor", v))];
  return resilientSearch(purpose, ents, LIMITS.memories);
}

export const getContext: GetContext = async (caseId: string, purpose: string): Promise<ContextPack> => {
  if (!isUuid(caseId)) return emptyPack();
  let base: CaseFacts | null;
  try {
    base = await loadFacts(caseId);
  } catch (e) {
    console.warn(`[getContext] facts failed for case ${caseId}:`, (e as Error).message);
    base = null;
  }
  if (!base) return emptyPack();

  const [passages, memories] = await Promise.all([
    loadPassages(caseId, purpose).catch((e) => {
      console.warn("[getContext] passages unavailable:", (e as Error).message);
      return [] as ContextItem[];
    }),
    loadMemories(caseId, purpose, base.projectId, base.vendorIds).catch((e) => {
      console.warn("[getContext] memories unavailable:", (e as Error).message);
      return [] as ContextItem[];
    }),
  ]);

  return { facts: base.facts, passages: bound(passages, LIMITS.passages), memories: bound(memories, LIMITS.memories) };
};
