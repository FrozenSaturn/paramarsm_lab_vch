/**
 * Plain-code parsers from quote text to numbers for scoring. The model never does this.
 * Each parser returns null when the text does not state the value.
 *
 * Strings seen in the four sample quotes (fixtures/quotes.json):
 * - mobilisation: "Within 14 days after getting the order"
 * - advance: "25% payment along with the order", "50% material secured advance against supply of material at site"
 * - payment_terms: "25% with order; RA bills paid within 30 days; final within 30 days of bills",
 *   "Monthly RA bills paid within 7 days; final bill within 15 days", "Will be fixed after discussion"
 * - warranty: "10 years on non-judicial stamp paper"
 */

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, sixty: 60, ninety: 90,
};

const NUM = `\\b(\\d+(?:\\.\\d+)?|${Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join("|")})`;
const toNum = (s: string) => (/^\d/.test(s) ? Number(s) : WORD_NUMBERS[s.toLowerCase()]);

type Period = "day" | "week" | "month" | "year";
const PERIOD_RE = new RegExp(`${NUM}\\s*(?:\\(\\s*\\d+\\s*\\)\\s*)?(?:working\\s+|calendar\\s+)?(day|week|month|year|yr|mon)s?\\b`, "i");

function firstPeriod(text: string): { n: number; unit: Period } | null {
  const m = text.match(PERIOD_RE);
  if (!m) return null;
  const n = toNum(m[1]);
  if (n == null || !Number.isFinite(n)) return null;
  const u = m[2].toLowerCase();
  const unit: Period = u.startsWith("d") ? "day" : u.startsWith("w") ? "week" : u === "yr" || u.startsWith("y") ? "year" : "month";
  return { n, unit };
}

const DAYS_PER: Record<Period, number> = { day: 1, week: 7, month: 30, year: 365 };
const MONTHS_PER: Record<Period, number> = { day: 1 / 30, week: 7 / 30, month: 1, year: 12 };

const blank = (t: string | null | undefined): t is null | undefined => !t || !t.trim();

/**
 * First period in the text, in days. "Within 14 days after getting the order" → 14,
 * "2 weeks" → 14, "3 months" → 90, "1 year" → 365. "Immediately" → 0.
 */
export function parseDays(text: string | null | undefined): number | null {
  if (blank(text)) return null;
  const p = firstPeriod(text);
  if (p) return Math.round(p.n * DAYS_PER[p.unit]);
  if (/\b(immediate(ly)?|at once|same day)\b/i.test(text)) return 0;
  return null;
}

/**
 * Days to complete the work from `completion_time`. Same rules as parseDays. When the text
 * gives a range ("60 to 75 days", "60-75 days"), the upper end counts, because that is
 * what the vendor commits to.
 */
export function parseCompletionDays(text: string | null | undefined): number | null {
  if (blank(text)) return null;
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:working\s+|calendar\s+)?(day|week|month|year)s?\b/i);
  if (range) {
    const unit = range[3].toLowerCase() as Period;
    return Math.round(Math.max(+range[1], +range[2]) * DAYS_PER[unit]);
  }
  return parseDays(text);
}

/** Words that mark a percentage as money paid before or with the order. */
const ADVANCE_CONTEXT = /advance|with\s+(?:the\s+)?(?:work\s+)?order|along\s+with|on\s+order|against\s+(?:the\s+)?order|before\s+(?:start|mobili)|mobili[sz]ation/i;

/**
 * Advance asked, in percent of the order value. "25% payment along with the order" → 25,
 * "25% with order; RA bills ..." → 25, "No advance" → 0. A percentage counts only in a
 * clause (split at ";" or ",") that also says advance or order, so "5% retention" is not an advance.
 */
export function parseAdvancePct(text: string | null | undefined): number | null {
  if (blank(text)) return null;
  if (/\b(no|nil|without|zero)\s+(?:mobili[sz]ation\s+)?advance\b|\badvance\s*[:\-]?\s*(nil|none|not\s+required|0\s*%)/i.test(text)) return 0;
  for (const clause of text.split(/[;,\n]/)) {
    const m = clause.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m && ADVANCE_CONTEXT.test(clause)) return Number(m[1]);
  }
  return null;
}

/**
 * Days of credit on running bills. "RA bills paid within 30 days" → 30, "Monthly RA bills
 * paid within 7 days; final bill within 15 days" → 7 (the running bills come first).
 * "100% advance" or "payment against order" with no period → 0. "Will be fixed after discussion" → null.
 */
export function parsePaymentDays(text: string | null | undefined): number | null {
  if (blank(text)) return null;
  const clauses = text.split(/[;\n]/);
  // Prefer the clause about running or monthly bills, then any clause with a period.
  const ordered = [...clauses.filter((c) => /\b(ra|running|monthly|bills?|invoice|payment)\b/i.test(c) && !/\bfinal\b/i.test(c)), ...clauses];
  for (const c of ordered) {
    if (ADVANCE_CONTEXT.test(c) && !/\bbills?\b/i.test(c)) continue; // "25% with order" is the advance, not credit
    const d = parseDays(c);
    if (d != null) return d;
  }
  if (/\b100\s*%\s*(advance|with\s+order|against\s+order|on\s+order)|\b(full|entire)\s+payment\s+(in\s+advance|with\s+order)|\bpayment\s+(against|on|with)\s+(the\s+)?order\b/i.test(text)) return 0;
  return null;
}

/**
 * Warranty or guarantee offered, in months. "10 years on non-judicial stamp paper" → 120,
 * "18 months" → 18, "No warranty" → 0.
 */
export function parseWarrantyMonths(text: string | null | undefined): number | null {
  if (blank(text)) return null;
  if (/\b(no|nil|without)\s+(warranty|guarantee)\b|\b(warranty|guarantee)\s*[:\-]?\s*(nil|none|not\s+(given|offered|applicable))/i.test(text)) return 0;
  const p = firstPeriod(text);
  if (!p) return null;
  return Math.round(p.n * MONTHS_PER[p.unit] * 100) / 100;
}
