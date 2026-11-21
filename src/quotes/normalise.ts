/**
 * Turns what the model read into comparable numbers and flags. Plain code only:
 * the same reading always gives the same result, and every number can be re-derived
 * from the printed values and the BOQ.
 */
import type { ExtractedQuote, HandwrittenRates } from "./schema";
import { TERM_KEYS, type TermKey, type TermStatus } from "./terms";
import { convertQty, convertRate, displayUnit, parseUnit, round, sameDim, type Unit } from "./units";
import { addDays, daysBetween, fmtDate, fmtINR, fmtNum, parseDate, parseValidityDays } from "./format";

export interface BoqLineIn {
  id: string | null;
  serial: string;
  description: string;
  unit: string | null;
  quantity: number | null;
}

export type Severity = "info" | "warn" | "block";
export interface Flag {
  code: string;
  severity: Severity;
  message: string;
  data?: Record<string, unknown>;
}

export interface NormalisedLine {
  serial: string;
  item: string;
  boq_serial: string | null;
  boq_line_id: string | null;
  unit_raw: string;
  unit: string;
  quantity: number | null;
  rate: number | null;
  amount_stated: number | null;
  /** Vendor's quantity × vendor's rate, as the vendor quoted it. */
  amount_computed: number | null;
  make: string | null;
  rate_handwritten: boolean;
  page: number;
  snippet: string;
  confidence: number;
  boq_unit: string | null;
  boq_quantity: number | null;
  /** Unit every vendor is compared in for this line (SQM for area, RMT for length). */
  normalized_unit: string | null;
  /** Vendor's rate per normalized_unit. */
  normalized_rate: number | null;
  /** BOQ quantity in normalized_unit. */
  boq_quantity_normalized: number | null;
  /** Vendor's rate × Vinayak's quantity. Null when the line cannot be compared. */
  amount_on_boq: number | null;
  /** Vendor quantity / BOQ quantity, both in the BOQ's unit. */
  qty_ratio: number | null;
  flags: Flag[];
}

export interface TermResult {
  term: TermKey;
  status: TermStatus;
  detail: string;
  page: number | null;
  snippet: string | null;
}

export interface NormalisedQuote {
  quote_date: string | null;
  validity_days: number | null;
  valid_until: string | null;
  gst: { treatment: "extra" | "inclusive" | "not_stated"; rate: number | null };
  lines: NormalisedLine[];
  missing_boq_serials: string[];
  /** Sum of the vendor's own quantity × rate. */
  vendor_total: number | null;
  stated_grand_total: number | null;
  /** Sum of vendor rate × Vinayak quantity over the comparable lines only. */
  total_on_boq: number | null;
  comparable_lines: number;
  boq_lines: number;
  scope: "matches" | "close" | "different" | "unknown";
  terms: TermResult[];
  flags: Flag[];
  needs_review: boolean;
  review_reasons: string[];
}

export interface NormaliseOptions {
  boq: BoqLineIn[];
  /** When the RFQ went out (ISO). A quote dated before it is stale. */
  rfqSentAt?: string | null;
  /** Date the comparison is made (ISO), for validity. Defaults to rfqSentAt, then today. */
  asOf?: string | null;
  /** A vendor quantity within this fraction of the BOQ's counts as the same scope. */
  qtyTolerance?: number;
  /** Rupees of difference allowed between a printed amount and quantity × rate. */
  amountTolerance?: number;
  /** Lines read with less confidence than this go to review. */
  confidenceThreshold?: number;
  secondRead?: HandwrittenRates | null;
  /** Fields a person has confirmed or corrected, keyed "line:<serial>:rate", "header:quote_date". See review.ts. */
  confirmed?: ReadonlySet<string>;
}

/** Flags that mean a person must look at the reading before it is used. */
export const REVIEW_CODES = new Set(["handwritten", "reads_disagree", "low_confidence", "no_rate", "arithmetic", "unreadable"]);

const pct = (r: number) => `${r >= 1 ? "+" : ""}${round((r - 1) * 100, 1)}%`;

export function normaliseQuote(q: ExtractedQuote, opts: NormaliseOptions): NormalisedQuote {
  const qtyTol = opts.qtyTolerance ?? 0.02;
  const amtTol = opts.amountTolerance ?? 1;
  const confMin = opts.confidenceThreshold ?? 0.8;
  const boqBySerial = new Map(opts.boq.map((b) => [String(b.serial).trim(), b]));
  const secondBySerial = new Map((opts.secondRead?.rates ?? []).map((r) => [String(r.serial).trim(), r]));
  const quoteFlags: Flag[] = [];
  const used = new Set<string>();
  const confirmed = opts.confirmed ?? new Set<string>();

  const lines: NormalisedLine[] = q.lines.map((l) => {
    const flags: Flag[] = [];
    const unit = parseUnit(l.unit);
    const boqSerial = l.boq_serial?.trim() || null;
    let boq = boqSerial ? boqBySerial.get(boqSerial) ?? null : null;
    if (boqSerial && !boq) flags.push({ code: "unmatched", severity: "warn", message: `Says it answers BOQ line ${boqSerial}, which is not in the BOQ` });
    if (!boqSerial) flags.push({ code: "unmatched", severity: "warn", message: "Does not match any BOQ line" });
    if (boq && used.has(boq.serial)) {
      flags.push({ code: "duplicate_line", severity: "warn", message: `A second line for BOQ line ${boq.serial}; only the first is compared` });
      boq = null;
    }
    if (boq) used.add(boq.serial);

    const amountComputed = l.quantity != null && l.rate != null ? round(l.quantity * l.rate) : null;

    // Reading checks
    if (l.rate == null) flags.push({ code: "no_rate", severity: "block", message: "No rate read for this line" });
    // Handwritten if either read says so: handwriting always goes to a person.
    const second = secondBySerial.get(String(l.serial).trim());
    const handwritten = l.rate_handwritten || !!second;
    const rateConfirmed = confirmed.has(`line:${String(l.serial).trim()}:rate`);
    if (handwritten && rateConfirmed) {
      flags.push({ code: "confirmed", severity: "info", message: `Handwritten rate confirmed by a person as ${fmtNum(l.rate)}` });
    } else if (handwritten) {
      if (!second || second.rate == null || !second.legible) {
        flags.push({ code: "reads_disagree", severity: "block", message: "The handwritten rate could not be read a second time. A person must read it", data: { first: l.rate, second: second?.rate ?? null } });
      } else if (l.rate == null || Math.abs(second.rate - l.rate) > 1e-9) {
        flags.push({ code: "reads_disagree", severity: "block", message: `Two independent reads of the handwritten rate disagree: ${fmtNum(l.rate)} and ${fmtNum(second.rate)}. A person must read it`, data: { first: l.rate, second: second.rate } });
      } else {
        flags.push({ code: "handwritten", severity: "warn", message: `Rate is handwritten; read twice as ${fmtNum(l.rate)}. Confirm it against the page`, data: { first: l.rate, second: second.rate } });
      }
    }
    if (l.confidence < confMin && !handwritten && !rateConfirmed) {
      flags.push({ code: "low_confidence", severity: "warn", message: `Read with low confidence (${round(l.confidence, 2)})` });
    }
    if (l.amount != null && amountComputed != null && Math.abs(l.amount - amountComputed) > amtTol) {
      // Unconfirmed, a difference may be a misread digit, so a person checks it. Once the rate is
      // confirmed, the difference is the vendor's own arithmetic: shown, but no longer a review item.
      flags.push({ code: rateConfirmed ? "vendor_arithmetic" : "arithmetic", severity: "warn", message: `Printed amount ${fmtINR(l.amount)} differs from quantity × rate ${fmtINR(amountComputed)} by ${fmtINR(Math.abs(round(l.amount - amountComputed)))}`, data: { stated: l.amount, computed: amountComputed } });
    }
    if (unit.dim === "unknown") flags.push({ code: "unit_unknown", severity: "warn", message: `Unit "${l.unit}" is not recognised` });

    // Comparison against Vinayak's BOQ line
    const boqUnit: (Unit & { raw: string }) | null = boq ? parseUnit(boq.unit) : null;
    let normalizedUnit: Unit | null = displayUnit(boqUnit && sameDim(unit, boqUnit) ? boqUnit.dim : unit.dim);
    let normalizedRate: number | null = l.rate != null && normalizedUnit ? convertRate(l.rate, unit, normalizedUnit) : null;
    let boqQtyNorm: number | null = null;
    let amountOnBoq: number | null = null;
    let qtyRatio: number | null = null;

    if (boq && boqUnit) {
      if (!sameDim(unit, boqUnit)) {
        flags.push({
          code: "unit_mismatch", severity: "warn",
          message: `Priced per ${unit.code} but the BOQ line is per ${boqUnit.code}; the two measure different things, so this line cannot be compared`,
          data: { vendor_unit: unit.code, boq_unit: boqUnit.code },
        });
        normalizedUnit = displayUnit(boqUnit.dim);
        normalizedRate = null;
      } else {
        if (l.rate != null && normalizedUnit && normalizedRate != null && unit.code !== normalizedUnit.code) {
          flags.push({ code: "unit_converted", severity: "info", message: `Quoted ${fmtINR(l.rate)} per ${unit.code} = ${fmtINR(round(normalizedRate))} per ${normalizedUnit.code}` });
        }
        if (boq.quantity != null && normalizedUnit) {
          boqQtyNorm = convertQty(boq.quantity, boqUnit, normalizedUnit);
          const rateInBoqUnit = l.rate != null ? convertRate(l.rate, unit, boqUnit) : null;
          amountOnBoq = rateInBoqUnit != null ? round(rateInBoqUnit * boq.quantity) : null;
          if (l.quantity != null && boq.quantity > 0) {
            const vendorQtyInBoqUnit = convertQty(l.quantity, unit, boqUnit)!;
            qtyRatio = vendorQtyInBoqUnit / boq.quantity;
            const off = Math.abs(qtyRatio - 1);
            if (off > qtyTol) {
              flags.push({
                code: "qty_differs", severity: "warn",
                message: `Priced ${fmtNum(l.quantity)} ${unit.code}; the BOQ has ${fmtNum(boq.quantity)} ${boqUnit.code} (${pct(qtyRatio)}). Compared on its rate against Vinayak's quantity`,
                data: { vendor_qty: l.quantity, boq_qty: boq.quantity, ratio: round(qtyRatio, 4) },
              });
            } else if (off > 1e-6) {
              flags.push({ code: "qty_close", severity: "info", message: `Priced ${fmtNum(l.quantity)} ${unit.code}, close to the BOQ's ${fmtNum(boq.quantity)} ${boqUnit.code} (${pct(qtyRatio)})` });
            }
          }
        }
      }
    }

    return {
      serial: l.serial, item: l.item, boq_serial: boq?.serial ?? null, boq_line_id: boq?.id ?? null,
      unit_raw: l.unit, unit: unit.code, quantity: l.quantity, rate: l.rate, amount_stated: l.amount,
      amount_computed: amountComputed, make: l.make, rate_handwritten: handwritten,
      page: l.page, snippet: l.snippet, confidence: l.confidence,
      boq_unit: boqUnit?.code ?? null, boq_quantity: boq?.quantity ?? null,
      normalized_unit: normalizedUnit?.code ?? null,
      normalized_rate: normalizedRate != null ? round(normalizedRate, 4) : null,
      boq_quantity_normalized: boqQtyNorm != null ? round(boqQtyNorm, 4) : null,
      amount_on_boq: amountOnBoq, qty_ratio: qtyRatio != null ? round(qtyRatio, 4) : null, flags,
    };
  });

  // BOQ coverage
  const missing = opts.boq.filter((b) => !used.has(b.serial)).map((b) => b.serial);
  if (missing.length) quoteFlags.push({ code: "missing_lines", severity: "warn", message: `Does not quote BOQ line${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`, data: { serials: missing } });
  const comparable = lines.filter((l) => l.amount_on_boq != null);
  const uncomparable = lines.filter((l) => l.boq_serial && l.amount_on_boq == null);
  if (uncomparable.length) {
    quoteFlags.push({ code: "lines_not_comparable", severity: "warn", message: `Line${uncomparable.length > 1 ? "s" : ""} ${uncomparable.map((l) => l.serial).join(", ")} cannot be compared with the BOQ`, data: { serials: uncomparable.map((l) => l.serial) } });
  }

  // Scope: did the vendor price Vinayak's quantities?
  const withRatio = lines.filter((l) => l.qty_ratio != null);
  const differ = withRatio.filter((l) => l.flags.some((f) => f.code === "qty_differs"));
  const close = withRatio.filter((l) => l.flags.some((f) => f.code === "qty_close"));
  let scope: NormalisedQuote["scope"] = "unknown";
  if (withRatio.length) {
    if (differ.length * 2 >= withRatio.length) {
      scope = "different";
      const ex = differ[0];
      quoteFlags.push({
        code: "different_scope", severity: "warn",
        message: `Priced a different scope: ${differ.length} of ${withRatio.length} lines use other quantities (line ${ex.serial}: ${fmtNum(ex.quantity)} ${ex.unit} against the BOQ's ${fmtNum(ex.boq_quantity)} ${ex.boq_unit}). Compared on its rates against Vinayak's quantities`,
        data: { lines_differ: differ.length, lines_checked: withRatio.length },
      });
    } else if (differ.length === 0 && close.length === 0) {
      scope = "matches";
      quoteFlags.push({ code: "scope_matches", severity: "info", message: `Priced Vinayak's quantities on all ${withRatio.length} lines` });
    } else {
      scope = "close";
      quoteFlags.push({
        code: "scope_close", severity: differ.length ? "warn" : "info",
        message: `Priced close to Vinayak's quantities (${withRatio.length - differ.length} of ${withRatio.length} lines within ${round(qtyTol * 100, 1)}%)`,
      });
    }
  }

  // Dates: stale, undated, validity
  const quoteDate = parseDate(q.header.quote_date.value);
  const rfqDate = opts.rfqSentAt ? opts.rfqSentAt.slice(0, 10) : null;
  const asOf = (opts.asOf ?? rfqDate ?? new Date().toISOString()).slice(0, 10);
  const validityDays = parseValidityDays(q.header.validity.value);
  const validUntil = quoteDate && validityDays != null ? addDays(quoteDate, validityDays) : null;
  if (!quoteDate) {
    quoteFlags.push({ code: "undated", severity: "warn", message: "The quote carries no date; ask the vendor to confirm it is current" });
  } else if (rfqDate && quoteDate < rfqDate) {
    const days = daysBetween(quoteDate, rfqDate);
    quoteFlags.push({
      code: "stale", severity: "warn",
      message: `Dated ${fmtDate(quoteDate)}, ${days} days before the RFQ went out on ${fmtDate(rfqDate)}; it was not priced for this RFQ`,
      data: { quote_date: quoteDate, rfq_sent: rfqDate, days },
    });
  }
  if (validUntil && validUntil < asOf) {
    quoteFlags.push({ code: "validity_expired", severity: "warn", message: `Offer was valid for ${validityDays} days and lapsed on ${fmtDate(validUntil)}`, data: { valid_until: validUntil } });
  }

  // GST
  const gstText = q.header.gst_treatment.value ?? "";
  const treatment: NormalisedQuote["gst"]["treatment"] = !gstText.trim()
    ? "not_stated"
    : /inclusive|including|incl\.?\s*(of\s*)?gst|with gst/i.test(gstText) && !/exclud/i.test(gstText)
      ? "inclusive"
      : "extra";
  const gstRateMatch = gstText.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  const gst = { treatment, rate: gstRateMatch ? +gstRateMatch[1] : null };
  if (treatment === "not_stated") quoteFlags.push({ code: "gst_not_stated", severity: "info", message: "GST is not mentioned; compared before GST and GST added at the standard rate" });
  if (treatment === "inclusive") quoteFlags.push({ code: "gst_inclusive", severity: "warn", message: "Rates include GST; GST is taken out before comparing" });

  // Vendor arithmetic on totals
  const vendorTotal = lines.every((l) => l.amount_computed != null) && lines.length ? round(lines.reduce((s, l) => s + l.amount_computed!, 0)) : null;
  const grand = q.stated_totals.find((t) => t.is_grand_total) ?? null;
  const statedGrand = grand?.amount ?? null;
  if (vendorTotal != null) {
    if (grand) {
      if (Math.abs(grand.amount - vendorTotal) > amtTol) {
        quoteFlags.push({ code: "total_mismatch", severity: "warn", message: `Printed total ${fmtINR(grand.amount)} differs from the sum of its lines ${fmtINR(vendorTotal)} by ${fmtINR(Math.abs(round(grand.amount - vendorTotal)))}`, data: { stated: grand.amount, computed: vendorTotal } });
      } else {
        quoteFlags.push({ code: "totals_agree", severity: "info", message: `Printed total ${fmtINR(grand.amount)} agrees with its lines` });
      }
    } else if (q.stated_totals.length) {
      const sub = round(q.stated_totals.reduce((s, t) => s + t.amount, 0));
      if (Math.abs(sub - vendorTotal) > amtTol * q.stated_totals.length) {
        quoteFlags.push({ code: "total_mismatch", severity: "warn", message: `Printed sub-totals add to ${fmtINR(sub)}; the lines add to ${fmtINR(vendorTotal)}`, data: { stated: sub, computed: vendorTotal } });
      } else {
        quoteFlags.push({ code: "totals_agree", severity: "info", message: `Printed sub-totals add to ${fmtINR(sub)}, which agrees with its lines` });
      }
    }
  }

  if (lines.some((l) => l.rate_handwritten)) quoteFlags.push({ code: "handwriting", severity: "warn", message: "Rates are handwritten; they wait for a person to confirm them" });

  // Terms: always all six, in order
  const byTerm = new Map(q.terms.map((t) => [t.term, t]));
  const terms: TermResult[] = TERM_KEYS.map((k) => {
    const t = byTerm.get(k);
    return t ? { term: k, status: t.status, detail: t.detail, page: t.page, snippet: t.snippet } : { term: k, status: "not_stated", detail: "Not mentioned", page: null, snippet: null };
  });

  // Review
  const reviewReasons: string[] = [];
  for (const l of lines) for (const f of l.flags) if (REVIEW_CODES.has(f.code)) reviewReasons.push(`Line ${l.serial}: ${f.message}`);
  if (q.header.quote_date.value && q.header.quote_date.confidence < confMin && !confirmed.has("header:quote_date")) reviewReasons.push(`Quote date read with low confidence (${q.header.quote_date.value})`);
  if (q.header.quote_date.value && !quoteDate) reviewReasons.push(`Quote date "${q.header.quote_date.value}" is not a valid date`);

  return {
    quote_date: quoteDate, validity_days: validityDays, valid_until: validUntil, gst,
    lines, missing_boq_serials: missing, vendor_total: vendorTotal, stated_grand_total: statedGrand,
    total_on_boq: comparable.length ? round(comparable.reduce((s, l) => s + l.amount_on_boq!, 0)) : null,
    comparable_lines: comparable.length, boq_lines: opts.boq.length, scope, terms,
    flags: quoteFlags, needs_review: reviewReasons.length > 0, review_reasons: reviewReasons,
  };
}
