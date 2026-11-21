/**
 * W6 comparative, as one plain function over the database (server only). The Inngest
 * function, the "Compare now" button and scripts/b/run-compare.ts all call runComparative.
 * It needs no request context: only admin(), logStep and publish.
 *
 *   load inputs -> build the matrix -> score -> save a new comparatives version and its scores
 */
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import { fmtINR } from "@/quotes/format";
import { scoreComparative, type ScoringResult } from "@/scoring";
import type { VendorScore, Weights } from "@/scoring/types";
import { publish } from "@/workflows/b/publish";
import { loadCompareInput, loadScoringExtras } from "./load";
import { buildMatrix, inputsHash } from "./matrix";
import type { CompareTrigger } from "./triggers";
import type { CompareInput, Matrix } from "./types";

export const W6 = "W6 comparative";

export interface RunComparativeArgs {
  caseId: string;
  trigger: CompareTrigger;
  /** User id, or the workflow or script name. */
  actor: string;
  /** Weights category. Null uses the "default" row. */
  category?: string | null;
}

export interface RunComparativeResult {
  comparativeId: string;
  version: number;
  matrix: Matrix;
  scores: VendorScore[];
  inputsHash: string;
  input: CompareInput;
  weights: Weights;
  category: string;
  facts: ScoringResult["facts"];
}

/** Builds the matrix and the scores without writing anything. */
export async function computeComparative(caseId: string, category: string | null = null) {
  const input = await loadCompareInput(caseId);
  if (!input.quotes.length) throw new Error("No live quotes on this case (ready or needs review). Read at least one quote before you compare.");
  const matrix = buildMatrix(input);
  const extras = await loadScoringExtras(caseId, matrix.vendors.map((v) => v.vendor_id), input.rfq_id, category);
  const result = scoreComparative(matrix, input, extras.extra, extras.weights);
  return { input, matrix, ...extras, ...result, inputsHash: inputsHash(input, extras.weights, extras.extra) };
}

/** Next version for the case, or 1. */
async function nextVersion(caseId: string): Promise<number> {
  const { data, error } = await admin().from("comparatives").select("version").eq("case_id", caseId).order("version", { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.version ?? 0) + 1;
}

/**
 * Builds and saves a new comparative version for the case. Every run is a new version.
 * Throws when the case has no live quotes.
 */
export async function runComparative(args: RunComparativeArgs): Promise<RunComparativeResult> {
  const db = admin();
  const c = await computeComparative(args.caseId, args.category ?? null);
  const quoteIds = c.matrix.vendors.map((v) => ({ quote_id: v.quote_id, vendor_id: v.vendor_id, version: v.version }));

  // Two runs at the same time can pick the same version: the unique key refuses one, and it tries the next.
  let saved: { id: string; version: number } | null = null;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    const version = await nextVersion(args.caseId);
    const { data, error } = await db.from("comparatives").insert({
      case_id: args.caseId, version, matrix: c.matrix, rfq_id: c.input.rfq_id, quote_ids: quoteIds,
      weights: c.weights, category: c.category, inputs_hash: c.inputsHash, trigger: args.trigger, created_by: args.actor,
    }).select("id,version").single();
    if (!error) saved = data;
    else if (error.code !== "23505") throw error;
  }
  if (!saved) throw new Error("Could not save the comparative: another run took each version number. Try again.");

  const { error: sErr } = await db.from("scores").insert(c.scores.map((s) => ({
    comparative_id: saved!.id, vendor_id: s.vendor_id, total: s.total, breakdown: s.params, flags: s.risk_flags, rank: s.rank,
  })));
  if (sErr) {
    // Do not leave a comparative without its scores.
    await db.from("comparatives").delete().eq("id", saved.id);
    throw sErr;
  }

  const name = (id: string | null) => c.matrix.vendors.find((v) => v.vendor_id === id)?.name ?? "—";
  const lowest = c.matrix.lowest_landed_vendor_id;
  const top = c.scores.find((s) => s.rank === 1);
  await logStep({
    caseId: args.caseId, workflow: W6, step: `Built comparative v${saved.version}`,
    input: { trigger: args.trigger, actor: args.actor, quote_ids: quoteIds, boq_version_id: c.input.boq_version_id, rfq_id: c.input.rfq_id, category: c.category, weights: c.weights },
    output: {
      comparative_id: saved.id, version: saved.version, inputs_hash: c.inputsHash, ranking_withheld: c.matrix.ranking_withheld,
      vendors: c.matrix.vendors.map((v) => {
        const t = c.matrix.totals[v.vendor_id];
        const s = c.scores.find((x) => x.vendor_id === v.vendor_id);
        return { vendor: v.name, before_gst: t.before_gst, gst: t.gst, landed: t.landed, loading: t.loading, landed_for_price: t.landed_for_price, score: s?.total, rank: s?.rank ?? null, risk: s?.risk_flags.map((f) => f.code) };
      }),
    },
    evidence: { quote_ids: quoteIds.map((q) => q.quote_id), document_ids: c.matrix.vendors.map((v) => v.document_id).filter(Boolean) },
    reasoning: [
      `${c.matrix.vendors.length} quote${c.matrix.vendors.length === 1 ? "" : "s"} compared on ${c.matrix.rows.length} BOQ lines.`,
      lowest ? `Lowest landed for price: ${name(lowest)} at ${fmtINR(c.matrix.totals[lowest].landed_for_price)}.` : "No vendor priced a line.",
      c.matrix.ranking_withheld ? "The ranking is withheld: fewer than three quotes." : top ? `Top score: ${name(top.vendor_id)} with ${top.total}.` : "",
    ].filter(Boolean).join(" "),
  });
  await publish("comparative.ready", { comparative_id: saved.id, case_id: args.caseId, version: saved.version }, { caseId: args.caseId, actor: W6 });

  return {
    comparativeId: saved.id, version: saved.version, matrix: c.matrix, scores: c.scores, inputsHash: c.inputsHash,
    input: c.input, weights: c.weights, category: c.category, facts: c.facts,
  };
}
