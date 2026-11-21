/**
 * W6 recommendation (server only): saved comparative → numbered facts → explanation →
 * `recommendations` row → `notify_hod` action for the contracts engineer to approve.
 *
 * The packet goes to the HOD only when the contracts engineer approves `notify_hod`. The
 * agent never selects a vendor: the HOD's decision is written by src/compare/decide.ts.
 */
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import { proposeAction } from "@/executor";
import { writeExplanation } from "@/agents/b/explain";
import { summaryText, type Explanation } from "@/agents/b/explain-check";
import { buildRecommendationFacts, orderedVendors, topVendors, type RecommendationFact } from "./recommend-facts";
import { loadComparative } from "./stored";

export const W6_RECOMMEND = "W6 recommendation";

export interface BuildRecommendationArgs {
  comparativeId: string;
  /** User id, or the workflow or script name. */
  actor: string;
}

export interface RankingEntry {
  vendor_id: string;
  name: string;
  rank: number | null;
  total: number;
}

export interface BuildRecommendationResult {
  recommendationId: string;
  caseId: string;
  comparativeId: string;
  topVendorId: string | null;
  withheld: boolean;
  notifyActionId: string | null;
  superseded: string[];
  explanation: Explanation;
  facts: RecommendationFact[];
  source: "model" | "template";
  model: string | null;
  costUsd: number;
  errors: string[];
}

/** Notify payload. Record ids come from here; the handler reads them from original_payload. */
export interface NotifyHodPayload {
  recommendation_id: string;
  comparative_id: string;
  top_vendor_id: string | null;
  summary: string;
}

const QUOTE_FIELDS = ["quote_date", "validity", "completion_time", "payment_terms", "advance", "warranty"];

/** PDF pages of terms and header fields, and the message that brought each quote. Reads only. */
async function loadProofTargets(vendors: { vendor_id: string; quote_id: string; document_id: string | null }[]) {
  const db = admin();
  const quoteIds = vendors.map((v) => v.quote_id);
  const vendorOfQuote = new Map(vendors.map((v) => [v.quote_id, v.vendor_id]));
  const termPages: Record<string, Record<string, number | null>> = {};
  const fieldPages: Record<string, Record<string, number | null>> = {};
  const messageIds: Record<string, string | null> = {};
  if (!quoteIds.length) return { termPages, fieldPages, messageIds };

  const { data: terms } = await db.from("quote_terms").select("id,quote_id,term").in("quote_id", quoteIds);
  const termById = new Map((terms ?? []).map((t: any) => [t.id as string, t as { quote_id: string; term: string }]));
  if (termById.size) {
    const { data: ev } = await db.from("extracted_fields").select("entity_id,page").eq("entity_type", "quote_term").in("entity_id", [...termById.keys()]);
    for (const e of (ev ?? []) as { entity_id: string; page: number | null }[]) {
      const t = termById.get(e.entity_id);
      const vid = t && vendorOfQuote.get(t.quote_id);
      if (vid && e.page) (termPages[vid] ??= {})[t.term] = e.page;
    }
  }
  const { data: qf } = await db.from("extracted_fields").select("entity_id,field,page").eq("entity_type", "quote").in("entity_id", quoteIds).in("field", QUOTE_FIELDS);
  for (const e of (qf ?? []) as { entity_id: string; field: string; page: number | null }[]) {
    const vid = vendorOfQuote.get(e.entity_id);
    if (vid && e.page) (fieldPages[vid] ??= {})[e.field] = e.page;
  }
  const docIds = vendors.map((v) => v.document_id).filter((d): d is string => !!d);
  if (docIds.length) {
    const { data: docs } = await db.from("documents").select("id,message_id").in("id", docIds);
    const msgOfDoc = new Map((docs ?? []).map((d: any) => [d.id as string, (d.message_id as string | null) ?? null]));
    for (const v of vendors) if (v.document_id) messageIds[v.vendor_id] = msgOfDoc.get(v.document_id) ?? null;
  }
  return { termPages, fieldPages, messageIds };
}

/**
 * Builds and saves a recommendation from a saved comparative. Older draft or with_hod
 * recommendations on the case become "superseded" (decided ones stay as they are).
 * When the ranking is withheld (fewer than three quotes) the row is saved as a draft and
 * no `notify_hod` action is proposed.
 */
export async function buildRecommendation(args: BuildRecommendationArgs): Promise<BuildRecommendationResult> {
  const db = admin();
  const c = await loadComparative(args.comparativeId);
  if (!c) throw new Error(`Comparative ${args.comparativeId} not found.`);
  const m = c.matrix;
  const withheld = m.ranking_withheld;

  const proof = await loadProofTargets(m.vendors.map((v) => ({ vendor_id: v.vendor_id, quote_id: v.quote_id, document_id: v.document_id })));
  const facts = buildRecommendationFacts(m, c.scores, { comparativeId: c.id, weights: c.weights, ...proof });
  const name = (id: string) => m.vendors.find((v) => v.vendor_id === id)?.name ?? id;
  const top = topVendors(m, c.scores).map((s) => ({ vendor_id: s.vendor_id, name: name(s.vendor_id) }));
  const ex = await writeExplanation(facts, { vendors: top });

  const ranking: RankingEntry[] = orderedVendors(m, c.scores).map((s) => ({ vendor_id: s.vendor_id, name: name(s.vendor_id), rank: s.rank, total: s.total }));
  const topVendorId = withheld ? null : ranking.find((r) => r.rank === 1)?.vendor_id ?? null;

  const { data: rec, error } = await db.from("recommendations").insert({
    comparative_id: c.id, case_id: c.case_id, ranking, explanation: ex.explanation, facts, top_vendor_id: topVendorId,
    model: ex.model ?? "template", prompt_version: ex.prompt_version, status: "draft", created_by: args.actor,
  }).select("id").single();
  if (error) throw error;
  const recommendationId = rec.id as string;

  // Only the newest packet can go to the HOD. A decided one stays as the record.
  const { data: old, error: supErr } = await db.from("recommendations").update({ status: "superseded" })
    .eq("case_id", c.case_id).in("status", ["draft", "with_hod"]).neq("id", recommendationId).select("id");
  if (supErr) throw supErr;
  const superseded = (old ?? []).map((r: any) => r.id as string);

  const summary = summaryText(ex.explanation);
  let notifyActionId: string | null = null;
  if (!withheld && topVendorId) {
    const payload: NotifyHodPayload = { recommendation_id: recommendationId, comparative_id: c.id, top_vendor_id: topVendorId, summary };
    const action = await proposeAction("notify_hod", c.case_id, payload as unknown as Record<string, unknown>);
    notifyActionId = action.id;
    const { error: nErr } = await db.from("recommendations").update({ notify_action_id: notifyActionId }).eq("id", recommendationId);
    if (nErr) throw nErr;
  }

  await logStep({
    caseId: c.case_id, workflow: W6_RECOMMEND, step: `Wrote recommendation from comparative v${c.version}`,
    model: ex.model ?? "template", prompt_version: ex.prompt_version,
    input: { comparative_id: c.id, version: c.version, actor: args.actor, facts: facts.length, top_vendors: top.map((v) => v.vendor_id) },
    output: {
      recommendation_id: recommendationId, status: "draft", top_vendor_id: topVendorId, ranking_withheld: withheld,
      notify_action_id: notifyActionId, superseded, source: ex.source, cost_usd: ex.cost_usd,
      calls: ex.calls, validation_errors: ex.errors,
    },
    evidence: { comparative_id: c.id, fact_ids: facts.map((f) => f.id) },
    reasoning: [
      summary,
      ex.source === "template" ? `Explanation from the plain-code template (${ex.errors.at(-1) ?? "no reason"}).` : `Explanation by ${ex.model}; each sentence passed the fact and number checks.`,
      withheld ? "Ranking withheld: no packet goes to the HOD." : notifyActionId ? "notify_hod proposed for the contracts engineer to approve." : "",
    ].filter(Boolean).join(" "),
    status: withheld ? "alert" : "done",
  });

  return {
    recommendationId, caseId: c.case_id, comparativeId: c.id, topVendorId, withheld, notifyActionId, superseded,
    explanation: ex.explanation, facts, source: ex.source, model: ex.model, costUsd: ex.cost_usd, errors: ex.errors,
  };
}
