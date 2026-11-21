/** Dates and money as Indian documents write them. Plain code, used by normalisation and the UI. */

/** ISO date (YYYY-MM-DD) from ISO, dd.mm.yyyy, dd-mm-yyyy, dd/mm/yyyy or dd/mm/yy. Null if it is not a real date. */
export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let y: number, m: number, d: number;
  let mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/))) {
    [d, m, y] = [+mt[1], +mt[2], +mt[3]];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const toUtc = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");

/** Whole days from a to b (positive when b is later). Both ISO dates or timestamps; only the date part is used. */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

export const addDays = (iso: string, days: number) => new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10);

/** "45 days from the date of quotation" → 45; "3 months" → 90; "2 weeks" → 14. Null if no period is stated. */
export function parseValidityDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*(day|week|month)s?/i);
  if (!m) return null;
  const n = +m[1];
  const unit = m[2].toLowerCase();
  return unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
}

/** 2026-05-21 → 21.05.2026, the way the quotes print it. */
export const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
/** 631187.91 → "₹6,31,187.91" */
export const fmtINR = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : (n < 0 ? "−₹" : "₹") + inr.format(Math.abs(n)));
/** 13429.53 → "13,429.53" */
export const fmtNum = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : num.format(n));
