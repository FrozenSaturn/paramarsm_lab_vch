/**
 * The numbered facts a recommendation is written from (PLAN.md section 7.4). Plain code
 * with no server imports.
 *
 * Rules:
 * - Each fact comes only from a computed value: the matrix, the scores and the risk flags.
 * - No fact holds text that a vendor wrote (no term detail, no quote notes). The model that
 *   writes the explanation sees only these facts, so a hostile quote cannot steer it.
 * - Each fact has one proof target: a PDF page, the comparative, the quote, a past work
 *   order or a message.
 * - The same matrix, scores and extras always give the same facts in the same order.
 */
import { fmtDate, fmtINR, fmtNum } from "@/quotes/format";
import { round } from "@/quotes/units";
import { PARAM_LABELS, PARAMS, type Param, type VendorScore, type Weights } from "@/scoring/types";
import type { Matrix, MatrixVendor } from "./types";

export type ProofType = "pdf_page" | "comparative" | "quote" | "performance" | "message";

export interface FactProof {
  type: ProofType;
  document_id?: string;
  page?: number;
  comparative_id?: string;
  quote_id?: string;
  /** BOQ serial of the matrix row. */
  row?: string;
  /** vendor_performance id, for a "performance" proof. */
  record_id?: string;
  /** messages id, for a "message" proof. */
  message_id?: string;
}

export type FactKind =
  | "overview" | "lowest_landed" | "weights" | "withheld"
  | "rank" | "landed" | "loading" | "param" | "lowest_line"
  | "terms_met" | "term_not_met" | "terms_not_stated" | "risk" | "scope";

export interface RecommendationFact {
  /** "F1", "F2", ... in the order of the list. */
  id: string;
  kind: FactKind;
  text: string;
  vendor_id?: string;
  /** For kind "param": which parameter. For kind "risk": the risk code. */
  key?: string;
  proof: FactProof;
}

export interface RecommendFactsExtras {
  comparativeId: string;
  /** Weights the scores were computed with. */
  weights?: Weights | null;
  /** PDF page of each RFQ term in each quote: vendor_id → term key → page. */
  termPages?: Record<string, Partial<Record<string, number | null>>>;
  /** PDF page of each quote header field: vendor_id → field (quote_date, validity, completion_time, payment_terms, ...) → page. */
  fieldPages?: Record<string, Partial<Record<string, number | null>>>;
  /** Message that brought each quote: vendor_id → messages id. */
  messageIds?: Record<string, string | null>;
  /** How many vendors get facts. Default 3. */
  topN?: number;
}

export const TOP_N = 3;

const SCOPE_TEXT: Record<MatrixVendor["scope"], string> = {
  matches: "prices the same scope as the BOQ",
  close: "prices a scope close to the BOQ quantities",
  different: "prices a different scope from the BOQ",
  unknown: "does not show enough to compare its scope with the BOQ",
};

const plural = (n: number, one: string, many = one + "s") => `${fmtNum(n)} ${n === 1 ? one : many}`;
const ordinal = (n: number) => fmtNum(n);
const clip = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/**
 * The vendors that get facts, best first: rank, then total (high first), then landed price
 * for comparison (low first), then vendor_id. When the ranking is withheld the order is by
 * total, so the same scores still give the same order.
 */
export function orderedVendors(matrix: Matrix, scores: VendorScore[]): VendorScore[] {
  const lfp = (id: string) => matrix.totals[id]?.landed_for_price ?? Number.POSITIVE_INFINITY;
  const known = new Set(matrix.vendors.map((v) => v.vendor_id));
  return scores.filter((s) => known.has(s.vendor_id)).sort((a, b) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
    || b.total - a.total
    || lfp(a.vendor_id) - lfp(b.vendor_id)
    || (a.vendor_id < b.vendor_id ? -1 : a.vendor_id > b.vendor_id ? 1 : 0));
}

/** The top N vendors (all when fewer). */
export const topVendors = (matrix: Matrix, scores: VendorScore[], n = TOP_N) => orderedVendors(matrix, scores).slice(0, n);

/**
 * Builds the numbered facts: case facts first, then the facts of each top vendor in order.
 * Each vendor's facts: rank, landed total, loading, the six parameter scores, lowest lines,
 * terms, risk flags and scope.
 */
export function buildRecommendationFacts(matrix: Matrix, scores: VendorScore[], extras: RecommendFactsExtras): RecommendationFact[] {
  const out: Omit<RecommendationFact, "id">[] = [];
  const cmp = (): FactProof => ({ type: "comparative", comparative_id: extras.comparativeId });
  const vendorById = new Map(matrix.vendors.map((v) => [v.vendor_id, v]));
  const nameOf = (id: string | null | undefined) => (id ? vendorById.get(id)?.name ?? id : "—");
  const ordered = orderedVendors(matrix, scores);
  const top = ordered.slice(0, Math.max(1, extras.topN ?? TOP_N));
  const n = matrix.vendors.length;

  // Case facts.
  out.push({
    kind: "overview", proof: cmp(),
    text: `${plural(n, "quote")} compared on ${plural(matrix.rows.length, "BOQ line")} at Vinayak's quantities${matrix.as_of ? `, as of ${fmtDate(matrix.as_of)}` : ""}.`,
  });
  const low = matrix.lowest_landed_vendor_id;
  if (low && matrix.totals[low]) {
    out.push({
      kind: "lowest_landed", vendor_id: low, proof: cmp(),
      text: `${nameOf(low)} has the lowest landed price for comparison: ${fmtINR(matrix.totals[low].landed_for_price)}.`,
    });
  }
  if (extras.weights) {
    const w = extras.weights;
    out.push({ kind: "weights", proof: cmp(), text: `Score weights: ${PARAMS.map((p) => `${PARAM_LABELS[p]} ${fmtNum(w[p])}`).join(", ")}.` });
  }
  if (matrix.ranking_withheld) {
    out.push({ kind: "withheld", proof: cmp(), text: `Only ${plural(n, "quote")} came in. The SOP needs 3 before a ranking, so the ranking is withheld.` });
  }

  for (const s of top) {
    const v = vendorById.get(s.vendor_id);
    if (!v) continue;
    const id = v.vendor_id;
    const name = v.name;
    const t = matrix.totals[id];
    const quoteProof = (page?: number | null): FactProof =>
      v.document_id && page ? { type: "pdf_page", document_id: v.document_id, page, quote_id: v.quote_id } : { type: "quote", quote_id: v.quote_id, ...(v.document_id ? { document_id: v.document_id } : {}) };
    const fieldPage = (f: string) => extras.fieldPages?.[id]?.[f] ?? null;

    // Rank and total.
    out.push({
      kind: "rank", vendor_id: id, proof: cmp(),
      text: s.rank != null
        ? `${name} ranks ${ordinal(s.rank)} of ${fmtNum(n)} with a score of ${fmtNum(s.total)} out of 100.`
        : `${name} scores ${fmtNum(s.total)} out of 100. No rank is given because the ranking is withheld.`,
    });

    // Landed total and loading.
    if (t) {
      const gstText = t.gst_basis === "inclusive" ? "GST included in the rates" : t.gst_basis === "assumed_standard" ? "GST not stated, so the standard rate is assumed" : "GST extra";
      out.push({
        kind: "landed", vendor_id: id, proof: cmp(),
        text: `${name}'s landed total is ${fmtINR(t.landed)}: ${fmtINR(t.before_gst)} before GST plus ${fmtINR(t.gst)} GST at ${fmtNum(round(t.gst_rate * 100))}% (${gstText}).`,
      });
      if (t.loading > 0) {
        out.push({
          kind: "loading", vendor_id: id, proof: cmp(),
          text: `${name} did not quote BOQ line${t.lines_missing.length === 1 ? "" : "s"} ${t.lines_missing.join(", ")}. ${t.lines_missing.length === 1 ? "It is" : "They are"} loaded at ${fmtINR(t.loading)} before GST, so the landed price for comparison is ${fmtINR(t.landed_for_price)}.`,
        });
      }
    }

    // The six parameter scores, in PARAMS order.
    for (const p of PARAMS) {
      const ps = s.params.find((x) => x.param === p);
      if (!ps) continue;
      out.push({
        kind: "param", key: p, vendor_id: id, proof: paramProof(p, ps.inputs, v, extras, cmp(), quoteProof, fieldPage),
        text: `${name}: ${PARAM_LABELS[p as Param]} scores ${fmtNum(ps.score)} of 100 (weight ${fmtNum(ps.weight)}, adds ${fmtNum(ps.contribution)}). ${ps.explain}${ps.label ? ` Label: ${ps.label}.` : ""}`,
      });
    }

    // Lowest lines, with the PDF page of each line.
    for (const row of matrix.rows) {
      const c = row.cells[id];
      if (!c || !c.lowest || c.amount == null || !row.lowest_vendor_ids.includes(id)) continue;
      const tie = row.lowest_vendor_ids.length > 1 ? " (tied)" : "";
      const unit = row.unit ?? "unit";
      out.push({
        kind: "lowest_line", vendor_id: id,
        proof: v.document_id && c.page ? { type: "pdf_page", document_id: v.document_id, page: c.page, quote_id: v.quote_id, row: row.serial } : { type: "comparative", comparative_id: extras.comparativeId, row: row.serial },
        text: `${name} is lowest${tie} on BOQ line ${row.serial} (${clip(row.description)}): ${c.rate != null ? `${fmtINR(c.rate)} per ${unit}, ` : ""}${fmtINR(c.amount)} on ${fmtNum(row.quantity)} ${unit}.`,
      });
    }

    // Terms: met as one fact, each "not met" as its own fact, "not stated" as one fact.
    const met: string[] = [], notStated: string[] = [];
    let firstMetPage: number | null = null;
    for (const row of matrix.terms) {
      const st = row.cells[id]?.status ?? "not_stated";
      const page = extras.termPages?.[id]?.[row.term] ?? null;
      if (st === "met") { met.push(row.label); if (firstMetPage == null && page) firstMetPage = page; }
      else if (st === "not_stated") notStated.push(row.label);
      else {
        out.push({ kind: "term_not_met", key: row.term, vendor_id: id, proof: page ? quoteProof(page) : cmp(), text: `${name} does not meet the RFQ term "${row.label}".` });
      }
    }
    if (met.length) {
      out.push({ kind: "terms_met", vendor_id: id, proof: firstMetPage ? quoteProof(firstMetPage) : cmp(), text: `${name} meets ${fmtNum(met.length)} of ${fmtNum(matrix.terms.length)} RFQ terms: ${met.join(", ")}.` });
    }
    if (notStated.length) {
      out.push({ kind: "terms_not_stated", vendor_id: id, proof: cmp(), text: `${name}'s quote does not state ${fmtNum(notStated.length)} of ${fmtNum(matrix.terms.length)} RFQ terms: ${notStated.join(", ")}.` });
    }

    // Risk flags (their messages are written by code: stale date, unconfirmed handwriting, ...).
    for (const f of s.risk_flags) {
      if (f.code === "fewer_than_three") continue; // the case fact "withheld" says this once
      let proof: FactProof = cmp();
      if (f.code === "stale") proof = quoteProof(fieldPage("quote_date"));
      else if (f.code === "validity_lapsed") proof = quoteProof(fieldPage("validity"));
      else if (f.code === "unconfirmed_handwriting" || f.code === "different_scope") proof = quoteProof(null);
      out.push({ kind: "risk", key: f.code, vendor_id: id, proof, text: `Risk for ${name}${f.severity === "block" ? " (must be cleared)" : ""}: ${f.message}` });
    }

    // Scope.
    out.push({ kind: "scope", vendor_id: id, proof: quoteProof(null), text: `${name}'s quote ${SCOPE_TEXT[v.scope] ?? SCOPE_TEXT.unknown}.` });
  }

  return out.map((f, i) => ({ id: `F${i + 1}`, ...f }));
}

function paramProof(
  p: Param, inputs: Record<string, unknown>, v: MatrixVendor, extras: RecommendFactsExtras, cmp: FactProof,
  quoteProof: (page?: number | null) => FactProof, fieldPage: (f: string) => number | null,
): FactProof {
  switch (p) {
    case "past_performance": {
      const records = Array.isArray(inputs?.records) ? (inputs.records as unknown[]).filter((x): x is string => typeof x === "string") : [];
      return records.length ? { type: "performance", record_id: records[0] } : cmp;
    }
    case "delivery_fit":
      return quoteProof(fieldPage("completion_time"));
    case "responsiveness": {
      const m = extras.messageIds?.[v.vendor_id];
      return m ? { type: "message", message_id: m, quote_id: v.quote_id } : quoteProof(fieldPage("quote_date"));
    }
    case "commercial":
      return quoteProof(fieldPage("payment_terms") ?? fieldPage("validity") ?? fieldPage("advance") ?? fieldPage("warranty"));
    default:
      return cmp;
  }
}
