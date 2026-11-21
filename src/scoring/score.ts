/**
 * Scores from computed facts (PLAN.md section 7.4). Each parameter scores 0–100. A missing
 * input gives NEUTRAL_SCORE with a visible label; the weights do not change. Risk flags sit
 * beside the score and never change it.
 *
 * Plain code with no server imports, so a client component can import it.
 */
import { fmtINR, fmtNum } from "@/quotes/format";
import { round } from "@/quotes/units";
import { NEUTRAL_SCORE, PARAMS, type Param, type ParamScore, type RiskFlag, type VendorFacts, type VendorScore, type Weights } from "./types";

type Part = Omit<ParamScore, "param" | "weight" | "contribution">;

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const neutral = (label: string, explain: string, inputs: Record<string, unknown>): Part =>
  ({ score: NEUTRAL_SCORE, neutral: true, label, explain, inputs });
const plural = (n: number, one: string, many = one + "s") => `${fmtNum(n)} ${n === 1 ? one : many}`;

/** Price = 100 × lowest landed_for_price / this vendor's landed_for_price. */
export function priceScore(f: VendorFacts): Part {
  const inputs = { landed_for_price: f.landed_for_price, lowest_landed_for_price: f.lowest_landed_for_price };
  if (!(f.landed_for_price > 0) || !(f.lowest_landed_for_price > 0)) {
    return neutral("no price", "No comparable price for this vendor: neutral 50.", inputs);
  }
  const score = round(clamp((100 * f.lowest_landed_for_price) / f.landed_for_price));
  const explain = f.landed_for_price === f.lowest_landed_for_price
    ? `${fmtINR(f.landed_for_price)} is the lowest landed price for comparison: 100.`
    : `${fmtINR(f.landed_for_price)} against the lowest ${fmtINR(f.lowest_landed_for_price)}: 100 × lowest ÷ this = ${fmtNum(score)}.`;
  const loaded = f.lines_missing ? ` The price includes ${plural(f.lines_missing, "missing line")} loaded at the highest other price.` : "";
  return { score, neutral: false, label: null, explain: explain + loaded, inputs: { ...inputs, lines_missing: f.lines_missing } };
}

/** Rating 1–5 mapped to 0–100. */
const ratingToScore = (r: number) => ((r - 1) / 4) * 100;
const RATING_KEYS = ["quality", "timeliness", "disputes", "safety"] as const;

/** Past performance = mean of all 1–5 ratings on the vendor's records, mapped 1 → 0 and 5 → 100. */
export function pastPerformanceScore(f: VendorFacts): Part {
  const used = f.performance.filter((r) => RATING_KEYS.some((k) => typeof r[k] === "number"));
  const ratings = used.flatMap((r) => RATING_KEYS.map((k) => r[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)));
  const demo = used.some((r) => r.is_demo);
  const inputs = { records: used.map((r) => r.id), ratings: ratings.length, demo };
  if (!ratings.length) return neutral("no history", "No past work orders are rated for this vendor: neutral 50.", inputs);
  const mean = ratings.reduce((s, r) => s + Math.min(5, Math.max(1, r)), 0) / ratings.length;
  const score = round(clamp(ratingToScore(mean)));
  return {
    score, neutral: false, label: demo ? "demo data" : null,
    explain: `Mean rating ${fmtNum(round(mean))} of 5 over ${plural(used.length, "record")} maps to ${fmtNum(score)}${demo ? " (includes demo data)" : ""}.`,
    inputs: { ...inputs, mean_rating: round(mean, 4) },
  };
}

/** Delivery fit: completion within the required days → 100, linear down to 0 at twice the required days. */
export function deliveryFitScore(f: VendorFacts): Part {
  const inputs = { completion_days: f.completion_days, required_days: f.required_days };
  if (f.required_days == null || !(f.required_days > 0)) return neutral("no required date", "The case has no required date: neutral 50.", inputs);
  if (f.completion_days == null) return neutral("completion not stated", "The quote states no completion period: neutral 50.", inputs);
  const c = f.completion_days, r = f.required_days;
  const score = round(c <= r ? 100 : clamp(100 * (2 - c / r)));
  return {
    score, neutral: false, label: null,
    explain: c <= r
      ? `Completes in ${plural(c, "day")}, within the ${plural(r, "day")} required: 100.`
      : `Completes in ${plural(c, "day")} against ${plural(r, "day")} required (0 at ${plural(2 * r, "day")}): ${fmtNum(score)}.`,
    inputs,
  };
}

const TERM_POINTS = { met: 1, not_stated: 0.5, not_met: 0 } as const;

/** Compliance = mean of the RFQ terms (met 1, not stated 0.5, not met 0) × 100, minus 100 ÷ BOQ lines per missing line, floored at 0. */
export function complianceScore(f: VendorFacts): Part {
  const count = { met: 0, not_stated: 0, not_met: 0 };
  for (const t of f.terms) count[t.status]++;
  const n = f.terms.length;
  const termsScore = n ? (f.terms.reduce((s, t) => s + TERM_POINTS[t.status], 0) / n) * 100 : NEUTRAL_SCORE;
  const perLine = f.boq_lines > 0 ? 100 / f.boq_lines : 0;
  const penalty = perLine * f.lines_missing;
  const score = round(clamp(termsScore - penalty));
  const inputs = { terms: { ...count }, terms_score: round(termsScore), boq_lines: f.boq_lines, lines_missing: f.lines_missing, penalty: round(penalty) };
  const termsText = n
    ? `${n} RFQ terms average ${fmtNum(round(termsScore))} (${count.met} met, ${count.not_stated} not stated, ${count.not_met} not met)`
    : "No RFQ terms were read (neutral 50)";
  const linesText = f.lines_missing
    ? `; ${f.lines_missing} of ${plural(f.boq_lines, "BOQ line")} missing takes off ${fmtNum(round(penalty))}`
    : "";
  return {
    score, neutral: !n, label: n ? null : "terms not read",
    explain: `${termsText}${linesText}: ${fmtNum(score)}.`,
    inputs,
  };
}

const FAST_HOURS = 48;
const SLOW_HOURS = 14 * 24;
const REMINDER_PENALTY = 10;

/**
 * Responsiveness: hours from RFQ to quote. 48 h or less → 100, linear down to 0 at 14 days.
 * A stale quote, or no RFQ send time, gives 50 with a label. Each reminder takes off 10, floor 0.
 */
export function responsivenessScore(f: VendorFacts): Part {
  const hours = f.rfq_sent_at && f.received_at ? (Date.parse(f.received_at) - Date.parse(f.rfq_sent_at)) / 3_600_000 : null;
  const inputs = { rfq_sent_at: f.rfq_sent_at, received_at: f.received_at, hours: hours == null || !Number.isFinite(hours) ? null : round(hours), stale: f.stale, reminders_sent: f.reminders_sent };
  let base: number, label: string | null = null, why: string;
  if (f.stale) {
    base = NEUTRAL_SCORE; label = "not priced for this RFQ";
    why = "The quote is dated before the RFQ went out, so it was not priced for this RFQ (neutral 50)";
  } else if (!f.rfq_sent_at) {
    base = NEUTRAL_SCORE; label = "no RFQ send time";
    why = "No RFQ send time is on record (neutral 50)";
  } else if (hours == null || !Number.isFinite(hours)) {
    base = NEUTRAL_SCORE; label = "no arrival time";
    why = "No arrival time is on record for the quote (neutral 50)";
  } else if (hours < 0) {
    base = NEUTRAL_SCORE; label = "arrived before RFQ";
    why = "The quote arrived before the RFQ went out (neutral 50)";
  } else {
    base = hours <= FAST_HOURS ? 100 : clamp((100 * (SLOW_HOURS - hours)) / (SLOW_HOURS - FAST_HOURS));
    why = `Quote came ${fmtNum(round(hours, 1))} h after the RFQ (${fmtNum(round(base))})`;
  }
  const penalty = REMINDER_PENALTY * f.reminders_sent;
  const score = round(clamp(base - penalty));
  const remText = f.reminders_sent ? `; ${plural(f.reminders_sent, "reminder")} take${f.reminders_sent === 1 ? "s" : ""} off ${penalty}` : "";
  const explain = label != null && !f.reminders_sent ? `${why.replace(/ \(neutral 50\)$/, "")}: neutral 50.` : `${why}${remText}: ${fmtNum(score)}.`;
  return { score, neutral: label != null, label, explain, inputs };
}

/** Advance asked: none → 100, up to 10% → 75, up to 25% → 50, more → 25. */
export const advanceSubScore = (pct: number) => (pct <= 0 ? 100 : pct <= 10 ? 75 : pct <= 25 ? 50 : 25);
/** Credit on bills: 30 days or more → 100, 15–29 → 75, 1–14 → 50, on order (0) → 25. */
export const paymentSubScore = (days: number) => (days >= 30 ? 100 : days >= 15 ? 75 : days >= 1 ? 50 : 25);
/** Validity left on the "as of" date: 30 days or more → 100, 0–29 → 50, lapsed (negative) → 0. */
export const validitySubScore = (days: number) => (days >= 30 ? 100 : days >= 0 ? 50 : 0);
/** Warranty: 60 months or more → 100, 12 or more → 75, more than 0 → 50, none → 0. */
export const warrantySubScore = (months: number) => (months >= 60 ? 100 : months >= 12 ? 75 : months > 0 ? 50 : 0);

/** Commercial terms = mean of the sub-scores the quote states (advance, payment, validity, warranty). */
export function commercialScore(f: VendorFacts): Part {
  const subs: { key: string; value: number; score: number; text: string }[] = [];
  if (f.advance_pct != null) subs.push({ key: "advance", value: f.advance_pct, score: advanceSubScore(f.advance_pct), text: `advance ${fmtNum(f.advance_pct)}%` });
  if (f.payment_days != null) subs.push({ key: "payment", value: f.payment_days, score: paymentSubScore(f.payment_days), text: f.payment_days > 0 ? `payment in ${plural(f.payment_days, "day")}` : "payment on order" });
  if (f.validity_days_left != null) subs.push({ key: "validity", value: f.validity_days_left, score: validitySubScore(f.validity_days_left), text: f.validity_days_left < 0 ? `validity lapsed ${plural(-f.validity_days_left, "day")} ago` : `${plural(f.validity_days_left, "day")} of validity left` });
  if (f.warranty_months != null) subs.push({ key: "warranty", value: f.warranty_months, score: warrantySubScore(f.warranty_months), text: `warranty ${plural(f.warranty_months, "month")}` });
  const inputs: Record<string, unknown> = {
    advance_pct: f.advance_pct, payment_days: f.payment_days, validity_days_left: f.validity_days_left, warranty_months: f.warranty_months,
    sub_scores: Object.fromEntries(subs.map((s) => [s.key, s.score])),
  };
  if (!subs.length) return neutral("terms not stated", "The quote states no advance, payment, validity or warranty terms: neutral 50.", inputs);
  const score = round(subs.reduce((s, x) => s + x.score, 0) / subs.length);
  const list = subs.map((s) => `${s.text} (${s.score})`).join(", ");
  const explain = subs.length === 1 ? `Only ${list} is stated: ${fmtNum(score)}.` : `${list[0].toUpperCase()}${list.slice(1)}: mean ${fmtNum(score)}.`;
  return { score, neutral: false, label: null, explain, inputs };
}

const SCORERS: Record<Param, (f: VendorFacts) => Part> = {
  price: priceScore, past_performance: pastPerformanceScore, delivery_fit: deliveryFitScore,
  compliance: complianceScore, responsiveness: responsivenessScore, commercial: commercialScore,
};

/** weight × score / 100, 2 places. */
export const contribution = (weight: number, score: number) => round((weight * score) / 100);
/** Sum of contributions, 2 places. */
export const totalOf = (params: ParamScore[]) => round(params.reduce((s, p) => s + p.contribution, 0));

/** The six parameter scores for one vendor, in PARAMS order. */
export function paramScores(f: VendorFacts, weights: Weights): ParamScore[] {
  return PARAMS.map((param) => {
    const part = SCORERS[param](f);
    const weight = weights[param];
    return { param, score: part.score, weight, contribution: contribution(weight, part.score), neutral: part.neutral, label: part.label, explain: part.explain, inputs: part.inputs };
  });
}

/** landed_for_price as the price parameter stored it; used for the tie-break. */
export const landedOf = (s: VendorScore) => {
  const v = s.params.find((p) => p.param === "price")?.inputs.landed_for_price;
  return typeof v === "number" ? v : Number.POSITIVE_INFINITY;
};

/**
 * Sets ranks and sorts. Order: total high to low; a tie goes to the lower landed_for_price,
 * then the lower vendor_id. When withheld, every rank is null and the list is in vendor_id order.
 */
export function applyRanks(scores: VendorScore[], withheld: boolean): VendorScore[] {
  const byId = (a: VendorScore, b: VendorScore) => (a.vendor_id < b.vendor_id ? -1 : a.vendor_id > b.vendor_id ? 1 : 0);
  if (withheld) return scores.map((s) => ({ ...s, rank: null })).sort(byId);
  const sorted = [...scores].sort((a, b) => b.total - a.total || landedOf(a) - landedOf(b) || byId(a, b));
  return sorted.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Scores every vendor with the given weights. Risk flags are copied beside the score.
 * Output is in rank order (then vendor_id); in vendor_id order when the ranking is withheld.
 */
export function scoreVendors(facts: VendorFacts[], weights: Weights, opts: { rankingWithheld: boolean; risk: Record<string, RiskFlag[]> }): VendorScore[] {
  const scores: VendorScore[] = facts.map((f) => {
    const params = paramScores(f, weights);
    return { vendor_id: f.vendor_id, total: totalOf(params), rank: null, params, risk_flags: opts.risk[f.vendor_id] ?? [] };
  });
  return applyRanks(scores, opts.rankingWithheld);
}
