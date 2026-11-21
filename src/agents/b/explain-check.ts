/**
 * Shape, validation and the plain-code fallback of the W6 explanation. No network and no
 * server imports, so the tests run alone.
 *
 * The validator is the guard on the model: each sentence must cite at least one fact that
 * exists, and each number in a sentence must appear in the text of a fact it cites.
 */
import type { RecommendationFact } from "@/compare/recommend-facts";

export interface ExplanationSentence {
  text: string;
  fact_ids: string[];
}

export interface Explanation {
  summary: ExplanationSentence[];
  vendors: { vendor_id: string; reasons: ExplanationSentence[] }[];
}

export const MIN_REASONS = 2;
export const MAX_REASONS = 4;
export const MAX_SUMMARY = 5;

/** Numbers as they appear in text: "₹13,81,464.00" → 1381464, "18%" → 18, "21.05.2026" → 21.05 and 2026. */
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const FACT_REF_RE = /\[?\bF\d+\b\]?/g;

function decimals(token: string): number {
  const i = token.indexOf(".");
  return i < 0 ? 0 : token.length - i - 1;
}

const toNumber = (token: string) => Number(token.replace(/,/g, ""));

/** Each number token in a text, with its decimal places. Fact references ("F12") are left out. */
export function numberTokens(text: string): { value: number; decimals: number; raw: string }[] {
  const clean = text.replace(FACT_REF_RE, " ");
  return (clean.match(NUMBER_RE) ?? [])
    .map((raw) => raw.replace(/,+$/, ""))
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, value: toNumber(raw), decimals: decimals(raw) }))
    .filter((t) => Number.isFinite(t.value));
}

/**
 * Every number a fact text allows: the number tokens, and also each plain run of digits, so
 * "21.05.2026" allows 21, 5 and 2026 too (the model may write the date in words).
 */
function allowedNumbers(texts: string[]): number[] {
  const out: number[] = [];
  for (const t of texts) {
    for (const n of numberTokens(t)) out.push(n.value);
    for (const run of t.replace(FACT_REF_RE, " ").match(/\d+/g) ?? []) out.push(Number(run));
  }
  return out;
}

/** True when the sentence number equals an allowed number, or an allowed number rounded to the sentence's decimal places. */
function numberAllowed(n: { value: number; decimals: number }, allowed: number[]): boolean {
  const eps = 1e-9;
  return allowed.some((a) => Math.abs(a - n.value) < eps || Math.abs(Number(a.toFixed(n.decimals)) - n.value) < eps);
}

/**
 * Checks the explanation against the facts. Returns a list of plain-language errors
 * (empty when it is valid).
 *
 * - The summary has 1 to MAX_SUMMARY sentences.
 * - Each top vendor appears once, with MIN_REASONS to MAX_REASONS reasons. No other vendor appears.
 * - Each sentence has text and at least one fact id, and each id exists.
 * - Each number in a sentence appears in the text of a fact the sentence cites.
 */
export function validateExplanation(e: unknown, facts: RecommendationFact[], topVendorIds: string[]): string[] {
  const errors: string[] = [];
  const x = e as Partial<Explanation> | null;
  if (!x || typeof x !== "object") return ["The explanation is not an object."];
  const byId = new Map(facts.map((f) => [f.id, f]));

  const checkSentence = (s: unknown, where: string) => {
    const sent = s as Partial<ExplanationSentence> | null;
    if (!sent || typeof sent.text !== "string" || !sent.text.trim()) { errors.push(`${where}: the sentence has no text.`); return; }
    const ids = Array.isArray(sent.fact_ids) ? sent.fact_ids.filter((i): i is string => typeof i === "string") : [];
    if (!ids.length) { errors.push(`${where}: "${sent.text}" cites no fact id.`); return; }
    const unknown = ids.filter((i) => !byId.has(i));
    if (unknown.length) errors.push(`${where}: "${sent.text}" cites unknown fact id${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}.`);
    const cited = ids.map((i) => byId.get(i)).filter((f): f is RecommendationFact => !!f);
    const allowed = allowedNumbers(cited.map((f) => f.text));
    const bad = numberTokens(sent.text).filter((n) => !numberAllowed(n, allowed)).map((n) => n.raw);
    if (bad.length) errors.push(`${where}: "${sent.text}" has number${bad.length === 1 ? "" : "s"} ${[...new Set(bad)].join(", ")} that ${bad.length === 1 ? "is" : "are"} not in the cited facts (${ids.join(", ")}).`);
  };

  if (!Array.isArray(x.summary) || !x.summary.length) errors.push("The summary has no sentences.");
  else {
    if (x.summary.length > MAX_SUMMARY) errors.push(`The summary has ${x.summary.length} sentences; the limit is ${MAX_SUMMARY}.`);
    x.summary.forEach((s, i) => checkSentence(s, `Summary sentence ${i + 1}`));
  }

  if (!Array.isArray(x.vendors)) errors.push("The vendors list is missing.");
  else {
    const seen = new Set<string>();
    for (const v of x.vendors) {
      const vid = (v as any)?.vendor_id;
      if (typeof vid !== "string" || !topVendorIds.includes(vid)) { errors.push(`Vendor ${String(vid)} is not one of the top vendors.`); continue; }
      if (seen.has(vid)) { errors.push(`Vendor ${vid} appears more than once.`); continue; }
      seen.add(vid);
      const reasons = Array.isArray(v.reasons) ? v.reasons : [];
      if (reasons.length < MIN_REASONS || reasons.length > MAX_REASONS) errors.push(`Vendor ${vid} has ${reasons.length} reasons; give ${MIN_REASONS} to ${MAX_REASONS}.`);
      reasons.forEach((r, i) => checkSentence(r, `Vendor ${vid} reason ${i + 1}`));
    }
    for (const id of topVendorIds) if (!seen.has(id)) errors.push(`Vendor ${id} has no reasons.`);
  }
  return errors;
}

const sentence = (f: RecommendationFact): ExplanationSentence => ({ text: f.text, fact_ids: [f.id] });

/**
 * A deterministic explanation in plain code, with the same shape as the model's. Each
 * sentence is the text of the fact it cites, so it always passes validateExplanation.
 */
export function templateExplanation(facts: RecommendationFact[], topVendorIds: string[]): Explanation {
  const pick = (kind: RecommendationFact["kind"], vendorId?: string) => facts.find((f) => f.kind === kind && (vendorId === undefined || f.vendor_id === vendorId));
  const summary: ExplanationSentence[] = [];
  const add = (f: RecommendationFact | undefined) => { if (f && summary.length < MAX_SUMMARY) summary.push(sentence(f)); };
  add(pick("overview"));
  add(pick("withheld"));
  if (topVendorIds[0]) add(pick("rank", topVendorIds[0]));
  add(pick("lowest_landed"));
  if (!summary.length && facts[0]) summary.push(sentence(facts[0]));

  const vendors = topVendorIds.map((vid) => {
    const mine = facts.filter((f) => f.vendor_id === vid);
    const chosen: RecommendationFact[] = [];
    const push = (f: RecommendationFact | undefined) => { if (f && !chosen.includes(f) && chosen.length < MAX_REASONS) chosen.push(f); };
    push(mine.find((f) => f.kind === "rank"));
    push(mine.find((f) => f.kind === "loading") ?? mine.find((f) => f.kind === "landed"));
    // The strongest parameter: highest contribution among scores that are not neutral (the text carries "adds N").
    const params = mine.filter((f) => f.kind === "param" && !/Label: (no history|no required date|completion not stated|terms not stated|terms not read|no price|not priced for this RFQ|no RFQ send time|no arrival time)/.test(f.text));
    const adds = (f: RecommendationFact) => Number(f.text.match(/adds ([\d,.]+)\)/)?.[1]?.replace(/,/g, "") ?? 0);
    push([...params].sort((a, b) => adds(b) - adds(a) || (a.id < b.id ? -1 : 1))[0]);
    push(mine.find((f) => f.kind === "risk" && /must be cleared/.test(f.text)) ?? mine.find((f) => f.kind === "risk") ?? mine.find((f) => f.kind === "term_not_met"));
    for (const f of mine) { if (chosen.length >= MIN_REASONS) break; push(f); }
    return { vendor_id: vid, reasons: chosen.sort((a, b) => facts.indexOf(a) - facts.indexOf(b)).map(sentence) };
  });
  return { summary, vendors };
}

/** Plain text of the summary, for the notify_hod payload and the mail body. */
export const summaryText = (e: Explanation) => e.summary.map((s) => s.text.trim()).join(" ");
