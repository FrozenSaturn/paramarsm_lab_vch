/**
 * Builds the comparative statement (PLAN.md section 7.3) from the live quotes. Plain code only.
 *
 * Rules:
 * - Every amount is the vendor's rate in the row's unit × Vinayak's quantity, rounded to 2 places.
 * - Every total is a sum of amounts shown in the matrix.
 * - The same input gives byte-identical JSON. The code does not read the clock.
 */
import { createHash } from "node:crypto";
import type { Flag } from "@/quotes/normalise";
import { DEFAULT_TERMS, TERM_KEYS } from "@/quotes/terms";
import { convertRate, parseUnit, round } from "@/quotes/units";
import { fmtINR } from "@/quotes/format";
import {
  MIN_QUOTES, STANDARD_GST_RATE,
  type CompareBoqLine, type CompareInput, type CompareQuote, type CompareQuoteLine,
  type Matrix, type MatrixCell, type MatrixRow, type MatrixTotals, type MatrixVendor, type TermsGridRow,
} from "./types";

/**
 * Tender "loading". When true, a vendor that did not quote a BOQ line, or quoted it in a unit
 * that cannot be converted, is loaded at the highest comparable amount of the other vendors on
 * that row. The load goes into `landed_for_price` only. Set it to false to compare on the
 * priced lines alone (then `loading` is 0 and `landed_for_price` equals `landed`).
 */
export const LOAD_MISSING_LINES = true;

export interface BuildMatrixOptions {
  /** Overrides LOAD_MISSING_LINES for one build. */
  loadMissing?: boolean;
}

/**
 * The amount a missing cell is loaded at: the highest of the other vendors' comparable
 * amounts on the row (before-GST basis). Null when no other vendor priced the row.
 */
export function loadedAmountFor(otherAmounts: number[]): number | null {
  return otherAmounts.length ? round(Math.max(...otherAmounts), 2) : null;
}

/** GST rate as a fraction. The database stores a percent (18); the matrix uses 0.18. */
export function gstFraction(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return rate > 1 ? rate / 100 : rate;
}

/** GST rate and basis the matrix uses for one quote. */
export function gstFor(q: Pick<CompareQuote, "gst_treatment" | "gst_rate">): { rate: number; basis: MatrixTotals["gst_basis"] } {
  if (q.gst_treatment === "extra") return { rate: gstFraction(q.gst_rate) ?? STANDARD_GST_RATE, basis: "extra" };
  if (q.gst_treatment === "inclusive") return { rate: gstFraction(q.gst_rate) ?? STANDARD_GST_RATE, basis: "inclusive" };
  return { rate: STANDARD_GST_RATE, basis: "assumed_standard" };
}

/** Plain code-unit order, so the order does not depend on the locale of the machine. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One live quote per vendor: the highest version wins. */
function liveQuotes(quotes: CompareQuote[]): { quotes: CompareQuote[]; dropped: CompareQuote[] } {
  const best = new Map<string, CompareQuote>();
  const dropped: CompareQuote[] = [];
  for (const q of quotes) {
    const cur = best.get(q.vendor_id);
    if (!cur) best.set(q.vendor_id, q);
    else if (q.version > cur.version || (q.version === cur.version && cmp(q.quote_id, cur.quote_id) > 0)) {
      dropped.push(cur);
      best.set(q.vendor_id, q);
    } else dropped.push(q);
  }
  const sorted = [...best.values()].sort((a, b) => cmp(a.vendor_name, b.vendor_name) || cmp(a.vendor_id, b.vendor_id));
  return { quotes: sorted, dropped };
}

/** The quote line that answers a BOQ line: by boq_line_id first, then by BOQ serial. First match wins. */
export function lineFor(q: CompareQuote, row: CompareBoqLine): CompareQuoteLine | null {
  if (row.id) {
    const byId = q.lines.find((l) => l.boq_line_id != null && l.boq_line_id === row.id);
    if (byId) return byId;
  }
  const serial = String(row.serial).trim();
  return q.lines.find((l) => l.boq_line_id == null && l.boq_serial != null && String(l.boq_serial).trim() === serial) ?? null;
}

/**
 * Vendor's rate in the row's unit, 4 places. Null when W5 found the line not comparable or the
 * units measure different things. The printed rate converts exactly; the normalised rate is the fallback.
 */
export function rateInRowUnit(l: CompareQuoteLine, rowUnit: string | null): number | null {
  if (l.normalized_rate == null) return null;
  const to = parseUnit(rowUnit);
  if (to.dim === "unknown") {
    return (rowUnit ?? "").trim().toUpperCase() === (l.normalized_unit ?? "").trim().toUpperCase() ? round(l.normalized_rate, 4) : null;
  }
  if (l.rate != null) {
    const r = convertRate(l.rate, parseUnit(l.unit_raw), to);
    if (r != null) return round(r, 4);
  }
  const r = convertRate(l.normalized_rate, parseUnit(l.normalized_unit), to);
  return r != null ? round(r, 4) : null;
}

/** Amount on the before-GST basis, so a GST-inclusive vendor is compared fairly on the row. */
const exGst = (amount: number, gst: { rate: number; basis: MatrixTotals["gst_basis"] }) =>
  gst.basis === "inclusive" ? round(amount / (1 + gst.rate), 2) : amount;

/**
 * Builds the matrix. Rows are the BOQ lines in BOQ order. Vendors are ordered by name, then id.
 * `as_of` is the RFQ due date, else the RFQ send date.
 */
export function buildMatrix(input: CompareInput, opts: BuildMatrixOptions = {}): Matrix {
  const loadMissing = opts.loadMissing ?? LOAD_MISSING_LINES;
  const { quotes, dropped } = liveQuotes(input.quotes);
  const gst = new Map(quotes.map((q) => [q.vendor_id, gstFor(q)]));
  const notes: string[] = [];

  // Rows and cells
  const rows: MatrixRow[] = input.boq.map((b) => {
    const cells: Record<string, MatrixCell> = {};
    for (const q of quotes) {
      const l = lineFor(q, b);
      const rate = l ? rateInRowUnit(l, b.unit) : null;
      const amount = rate != null && b.quantity != null ? round(rate * b.quantity, 2) : null;
      const flags: Flag[] = l ? [...l.flags] : [];
      // A row with no quantity is nobody's fault: it is left out of the totals, not loaded.
      const missing = b.quantity != null && amount == null;
      if (missing && !l) flags.push({ code: "not_quoted", severity: "warn", message: `Does not quote BOQ line ${b.serial}` });
      else if (missing) flags.push({ code: "not_comparable", severity: "warn", message: `Line ${b.serial} cannot be compared in ${b.unit ?? "the BOQ unit"}` });
      cells[q.vendor_id] = {
        quote_line_id: l?.id ?? null,
        unit_raw: l?.unit_raw ?? null,
        rate_raw: l?.rate ?? null,
        rate, amount, lowest: false, missing, loaded_amount: null,
        page: l?.page ?? null,
        handwritten: l?.rate_handwritten ?? false,
        confirmed: l?.rate_confirmed ?? false,
        flags,
      };
    }
    // Lowest: compared before GST; ties are all lowest; missing cells are never lowest.
    const priced = quotes.filter((q) => cells[q.vendor_id].amount != null);
    const basis = new Map(priced.map((q) => [q.vendor_id, exGst(cells[q.vendor_id].amount!, gst.get(q.vendor_id)!)]));
    const min = priced.length ? Math.min(...basis.values()) : null;
    const lowest: string[] = [];
    for (const q of priced) if (basis.get(q.vendor_id) === min) { cells[q.vendor_id].lowest = true; lowest.push(q.vendor_id); }
    // Loading: the highest comparable amount of the other vendors on this row.
    if (loadMissing) {
      for (const q of quotes) {
        const c = cells[q.vendor_id];
        if (!c.missing) continue;
        c.loaded_amount = loadedAmountFor(priced.filter((p) => p.vendor_id !== q.vendor_id).map((p) => basis.get(p.vendor_id)!));
      }
    }
    return { boq_line_id: b.id, serial: b.serial, description: b.description, unit: b.unit, quantity: b.quantity, cells, lowest_vendor_ids: lowest };
  });

  // Totals
  const totals: Record<string, MatrixTotals> = {};
  for (const q of quotes) {
    const g = gst.get(q.vendor_id)!;
    const cells = rows.map((r) => r.cells[q.vendor_id]);
    const sum = round(cells.reduce((s, c) => s + (c.amount ?? 0), 0), 2);
    const beforeGst = g.basis === "inclusive" ? round(sum / (1 + g.rate), 2) : sum;
    const gstAmt = g.basis === "inclusive" ? round(sum - beforeGst, 2) : round(beforeGst * g.rate, 2);
    const loading = round(cells.reduce((s, c) => s + (c.missing ? c.loaded_amount ?? 0 : 0), 0), 2);
    totals[q.vendor_id] = {
      vendor_id: q.vendor_id,
      before_gst: beforeGst,
      gst_rate: g.rate,
      gst_basis: g.basis,
      gst: gstAmt,
      landed: round(beforeGst + gstAmt, 2),
      lines_priced: cells.filter((c) => c.amount != null).length,
      lines_missing: rows.filter((r) => r.cells[q.vendor_id].missing).map((r) => r.serial),
      loading,
      landed_for_price: round((beforeGst + loading) * (1 + g.rate), 2),
    };
  }

  // Lowest landed for price. A vendor that priced no line cannot be lowest. Ties go to the lower vendor_id.
  let lowestLanded: string | null = null;
  for (const q of quotes) {
    const t = totals[q.vendor_id];
    if (t.lines_priced === 0) continue;
    const cur = lowestLanded ? totals[lowestLanded] : null;
    if (!cur || t.landed_for_price < cur.landed_for_price || (t.landed_for_price === cur.landed_for_price && cmp(t.vendor_id, cur.vendor_id) < 0)) lowestLanded = q.vendor_id;
  }

  // Terms grid: always the six terms, in order
  const terms: TermsGridRow[] = TERM_KEYS.map((k) => ({
    term: k,
    label: DEFAULT_TERMS[k].label,
    cells: Object.fromEntries(quotes.map((q) => {
      const t = q.terms.find((x) => x.term === k);
      return [q.vendor_id, { status: t?.status ?? "not_stated", detail: t?.detail?.trim() ? t.detail : null }];
    })),
  }));

  const vendors: MatrixVendor[] = quotes.map((q) => ({
    vendor_id: q.vendor_id, name: q.vendor_name, quote_id: q.quote_id, version: q.version, status: q.status,
    document_id: q.document_id, quote_date: q.quote_date, received_at: q.received_at, scope: q.scope, flags: q.flags,
  }));

  // Notes, in a fixed order
  const rankingWithheld = quotes.length < MIN_QUOTES;
  if (rankingWithheld) {
    notes.push(`Fewer than ${MIN_QUOTES} quotes (${quotes.length}): the SOP needs ${MIN_QUOTES} before a ranking. Scores are shown; the ranking is withheld.`);
  }
  for (const d of dropped) notes.push(`${d.vendor_name}: version ${d.version} is replaced by a newer version and is not compared.`);
  for (const r of rows) if (r.quantity == null) notes.push(`Line ${r.serial} has no quantity in the BOQ. It is left out of all totals.`);
  for (const q of quotes) {
    const t = totals[q.vendor_id];
    for (const serial of t.lines_missing) {
      const c = rows.find((r) => r.serial === serial)!.cells[q.vendor_id];
      const what = c.flags.some((f) => f.code === "not_quoted") ? "does not quote" : "cannot be compared on";
      const load = !loadMissing
        ? "No loading is applied."
        : c.loaded_amount != null
          ? `For the price comparison it is loaded at ${fmtINR(c.loaded_amount)}, the highest amount of the other vendors on this line.`
          : "No other vendor priced this line, so no loading is applied.";
      notes.push(`${q.vendor_name} ${what} line ${serial}. ${load}`);
    }
    if (t.gst_basis === "assumed_standard") notes.push(`${q.vendor_name} does not state GST. GST at ${round(t.gst_rate * 100, 2)}% is added for the comparison.`);
    if (t.gst_basis === "inclusive") notes.push(`${q.vendor_name} quotes rates that include GST. GST at ${round(t.gst_rate * 100, 2)}% is taken out before the comparison.`);
    const unconfirmed = rows.filter((r) => r.cells[q.vendor_id].handwritten && !r.cells[q.vendor_id].confirmed).length;
    if (unconfirmed) notes.push(`${q.vendor_name} has ${unconfirmed} handwritten rate${unconfirmed > 1 ? "s" : ""} that a person has not confirmed.`);
  }

  return {
    schema_version: 1,
    case_id: input.case_id,
    rfq_id: input.rfq_id,
    boq_version_id: input.boq_version_id,
    as_of: asOfDate(input),
    currency: "INR",
    vendors, rows, totals,
    lowest_landed_vendor_id: lowestLanded,
    terms, notes,
    ranking_withheld: rankingWithheld,
  };
}

/** The comparison's "as of" date (ISO date): the RFQ due date, else the date the RFQ went out. */
export function asOfDate(input: Pick<CompareInput, "rfq_due_date" | "rfq_sent_at">): string | null {
  const s = input.rfq_due_date ?? input.rfq_sent_at;
  return s ? s.slice(0, 10) : null;
}

/** JSON with object keys sorted at every level. Arrays keep their order; undefined values are dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort(cmp)) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/**
 * sha256 (hex) over the canonical JSON of the input and the weights. Quotes are sorted by
 * vendor_id and quote_id first, so the order the loader reads them in does not change the hash.
 * `extra` is the scoring input that is not in CompareInput (ratings, reminders, required days).
 * Same hash means the stored comparative is still current.
 */
export function inputsHash(input: CompareInput, weights: Record<string, number>, extra?: unknown): string {
  const quotes = [...input.quotes].sort((a, b) => cmp(a.vendor_id, b.vendor_id) || cmp(a.quote_id, b.quote_id));
  const body = extra === undefined ? { input: { ...input, quotes }, weights } : { input: { ...input, quotes }, weights, extra };
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}
