/** Hygiene report for the item-code master. Plain code: the same rows always give the same report. */
export interface CodeRow { id: string; code: string; description: string; erp_serial: number | null }

export const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normDesc = (d: string) => d.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const trigrams = (s: string) => { const t = `  ${s} `; const out = new Set<string>(); for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3)); return out; };
/** Dice coefficient on trigrams, 0 to 1. */
export function similarity(a: string, b: string): number {
  const A = trigrams(normDesc(a)), B = trigrams(normDesc(b));
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return A.size + B.size ? (2 * inter) / (A.size + B.size) : 0;
}

export interface HygieneReport {
  exactDuplicates: { code: string; description: string; serials: (number | null)[] }[];
  codeConflicts: { code: string; meanings: { description: string; serials: (number | null)[] }[] }[];
  formatVariants: { key: string; codes: string[] }[];
  sameMeaningDifferentCodes: { description: string; codes: { code: string; serial: number | null }[] }[];
  nearDuplicates: { a: CodeRow; b: CodeRow; similarity: number }[];
  formatAnomalies: { code: string; serial: number | null; problem: string }[];
  totals: { rows: number; distinctCodes: number };
}

const group = <T,>(items: T[], key: (t: T) => string) => { const m = new Map<string, T[]>(); for (const i of items) { const k = key(i); (m.get(k) ?? m.set(k, []).get(k)!).push(i); } return m; };

export function hygieneReport(rows: CodeRow[], nearThreshold = 0.88): HygieneReport {
  const exactDuplicates: HygieneReport["exactDuplicates"] = [];
  const codeConflicts: HygieneReport["codeConflicts"] = [];
  // Same code text (ignoring case and spaces): are the descriptions the same thing or different things?
  for (const [code, rs] of group(rows, r => r.code.trim().toUpperCase())) {
    if (rs.length < 2) continue;
    const byDesc = group(rs, r => normDesc(r.description));
    if (byDesc.size === 1) exactDuplicates.push({ code, description: rs[0].description.trim(), serials: rs.map(r => r.erp_serial) });
    else codeConflicts.push({ code, meanings: [...byDesc.values()].map(g => ({ description: g[0].description.trim(), serials: g.map(r => r.erp_serial) })) });
  }
  // Different spellings of one code ("W.P.01", "WP.01", "WP01") that normalise to the same key.
  const formatVariants = [...group(rows, r => normCode(r.code))].map(([key, rs]) => ({ key, codes: [...new Set(rs.map(r => r.code.trim()))] }))
    .filter(g => g.codes.length > 1);
  // One meaning under several codes: identical description, different codes.
  const sameMeaningDifferentCodes = [...group(rows, r => normDesc(r.description))]
    .map(([, rs]) => ({ description: rs[0].description.trim(), codes: rs.map(r => ({ code: r.code.trim(), serial: r.erp_serial })) }))
    .filter(g => new Set(g.codes.map(c => c.code.toUpperCase())).size > 1);
  // Close but not identical descriptions under different codes. Variant pairs (-A / -B) are real and are shown, not hidden.
  const nearDuplicates: HygieneReport["nearDuplicates"] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (a.code.trim().toUpperCase() === b.code.trim().toUpperCase()) continue;
    if (normDesc(a.description) === normDesc(b.description)) continue; // already in sameMeaningDifferentCodes
    const s = similarity(a.description, b.description);
    const k = [normCode(a.code), normCode(b.code), normDesc(a.description), normDesc(b.description)].sort().join("|");
    if (s >= nearThreshold && !seen.has(k)) { seen.add(k); nearDuplicates.push({ a, b, similarity: Math.round(s * 100) / 100 }); }
  }
  nearDuplicates.sort((x, y) => y.similarity - x.similarity);
  const formatAnomalies: HygieneReport["formatAnomalies"] = [];
  for (const r of rows) {
    const c = r.code;
    if (c !== c.trim()) formatAnomalies.push({ code: c, serial: r.erp_serial, problem: "leading or trailing space" });
    if (/[_.-]$/.test(c.trim())) formatAnomalies.push({ code: c, serial: r.erp_serial, problem: "ends with a separator" });
    if (/\.\./.test(c)) formatAnomalies.push({ code: c, serial: r.erp_serial, problem: "double dot" });
    if (/_/.test(c) && /\./.test(c)) formatAnomalies.push({ code: c, serial: r.erp_serial, problem: "mixes '_' and '.'" });
    if (/^\W*\*/.test(r.description)) formatAnomalies.push({ code: c, serial: r.erp_serial, problem: "description starts with '*'" });
  }
  return { exactDuplicates, codeConflicts, formatVariants, sameMeaningDifferentCodes, nearDuplicates, formatAnomalies, totals: { rows: rows.length, distinctCodes: new Set(rows.map(r => r.code.trim().toUpperCase())).size } };
}
