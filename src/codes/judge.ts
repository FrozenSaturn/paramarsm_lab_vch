/** Rule-based judge. Same inputs always give the same answer, and every number can be re-derived.
 *  The model judge (Claude) can be added behind this same function later; its answer would be compared with this one. */
import { normCode, normDesc } from "../erp/hygiene";
import { attrsOf, compareAttrs, descSimilarity } from "./attributes";
import type { Candidate } from "./candidates";

export const THRESHOLDS = { auto: 0.78, margin: 0.06, newBelow: 0.45 } as const;

export interface Pick {
  ids: string[]; code: string; description: string; erp_serial: number | null; serials: (number | null)[];
  score: number; agree: string[]; differ: string[]; conflicts: string[]; sameMeaningCodes: string[];
}
export interface Suggestion {
  type: "code_suggestion"; decision: "auto" | "review" | "new"; confidence: number; judged_by: "rules" | "rules+claude" | "alias";
  reason: string; warnings: string[]; picks: Pick[];
  model?: { code: string | null; confidence: number; reason: string; model: string; error?: string };
  proposed_new?: { code: string; description: string; nearest: { code: string; description: string }[] };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function judge(site: { description: string; siteCode: string | null }, found: { candidates: Candidate[]; siteCodeRows: Candidate[] }, allCodes: string[]): Suggestion {
  const siteAttrs = attrsOf(site.description, site.siteCode ?? "");
  // One group per code and meaning: the same code listed twice in the master is one choice.
  const groups = new Map<string, Candidate[]>();
  for (const c of [...found.candidates, ...found.siteCodeRows]) {
    const k = `${normCode(c.code)}|${normDesc(c.description)}`;
    const g = groups.get(k) ?? [];
    if (!g.some(x => x.id === c.id)) g.push(c);
    groups.set(k, g);
  }
  // Show the clean spelling of a code and the earliest ERP row. "WP.11.B_" is the same code with a typo.
  const dirty = (code: string) => (/[_.\-\s]$/.test(code) ? 1 : 0);
  const scored = [...groups.values()].map(unsorted => {
    const rows = [...unsorted].sort((a, b) => dirty(a.code) - dirty(b.code) || (a.erp_serial ?? 1e9) - (b.erp_serial ?? 1e9));
    const c = rows[0];
    const d = normDesc(c.description) === normDesc(site.description) ? 1 : descSimilarity(site.description, c.description);
    const emb = rows.map(r => r.embScore).find(x => x != null);
    const embScaled = emb != null ? clamp((emb - 0.8) / 0.2) : d;
    const cmp = compareAttrs(siteAttrs, attrsOf(c.description, c.code));
    const codeMatch = site.siteCode && normCode(site.siteCode) === normCode(c.code) ? 1 : 0;
    let score = 0.35 * d + 0.2 * embScaled + 0.25 * cmp.agreement + 0.2 * codeMatch;
    if (cmp.conflicts.length) score *= 0.4;
    return { rows, c, d, score, cmp };
  }).sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code));

  const picks: Pick[] = scored.slice(0, 5).map(s => ({
    ids: s.rows.map(r => r.id), code: s.c.code, description: s.c.description, erp_serial: s.c.erp_serial, serials: s.rows.map(r => r.erp_serial),
    score: Math.round(s.score * 100) / 100, agree: s.cmp.agree, differ: s.cmp.differ, conflicts: s.cmp.conflicts,
    // the same wording under other codes in the master
    sameMeaningCodes: scored.filter(o => o !== s && normDesc(o.c.description) === normDesc(s.c.description)).map(o => o.c.code),
  }));

  const warnings: string[] = [];
  const top = scored[0], second = scored[1];
  if (site.siteCode) {
    const rows = found.siteCodeRows;
    if (!rows.length) warnings.push(`Site code ${site.siteCode} is not in the master.`);
    else if (top && !rows.some(r => normCode(r.code) === normCode(top.c.code) && normDesc(r.description) === normDesc(top.c.description))) {
      // The site's own code exists but means something else here. This is the "WP.08" case.
      const meanings = [...new Set(rows.map(r => r.description.trim()))].join(" / ");
      warnings.push(`Site code ${site.siteCode} is "${meanings}" in the master. The site wording matches ${top.c.code} better.`);
    }
  }
  const nearest = scored.slice(0, 3).map(s => ({ code: s.c.code, description: s.c.description }));
  if (!top || top.score < THRESHOLDS.newBelow)
    return { type: "code_suggestion", decision: "new", confidence: top ? Math.round(top.score * 100) / 100 : 0, judged_by: "rules",
      reason: "No master code is close enough. A new code is proposed.", warnings, picks,
      proposed_new: { code: proposeNewCode(site.siteCode, nearest[0]?.code ?? null, allCodes), description: site.description.trim(), nearest } };

  const margin = second ? top.score - second.score : 1;
  const reasons: string[] = [];
  if (top.cmp.conflicts.length) reasons.push(`conflict: ${top.cmp.conflicts.join("; ")}`);
  if (top.score < THRESHOLDS.auto) reasons.push(`score ${top.score.toFixed(2)} is below ${THRESHOLDS.auto}`);
  if (margin < THRESHOLDS.margin) reasons.push(second && normDesc(second.c.description) === normDesc(top.c.description)
    ? `the same wording is under ${top.c.code} and ${second.c.code} in the master`
    : `${second?.c.code} is almost as good (margin ${margin.toFixed(2)})`);
  reasons.push(...warnings);
  const auto = !reasons.length;
  return { type: "code_suggestion", decision: auto ? "auto" : "review", confidence: Math.round(top.score * 100) / 100, judged_by: "rules",
    reason: auto ? `Matches ${top.c.code}: ${top.cmp.agree.join("; ") || "description"}.${top.cmp.differ.length ? ` Note: ${top.cmp.differ.join("; ")}.` : ""}` : reasons.join(" | "), warnings, picks };
}

/** A new code follows the pattern of the nearest code. If the site's own code is free, use it. */
export function proposeNewCode(siteCode: string | null, nearestCode: string | null, allCodes: string[]): string {
  const taken = new Set(allCodes.map(normCode));
  if (siteCode && !taken.has(normCode(siteCode))) return siteCode.trim();
  const m = nearestCode?.match(/^([A-Za-z]+)\.(\d+)/);
  if (!m) return `NEW.${String(allCodes.length + 1).padStart(2, "0")}`;
  const re = new RegExp(`^${m[1]}\\.(\\d+)$`, "i");
  const max = Math.max(0, ...allCodes.map(c => c.match(re)?.[1]).filter(Boolean).map(Number));
  return `${m[1].toUpperCase()}.${String(max + 1).padStart(m[2].length, "0")}`;
}

/** Combine the rule answer with the model answer. A line is auto-matched only when both agree. */
export function combine(rules: Suggestion, m: { choice: number; confidence: number; reason: string; model: string; site_code_means_something_else: boolean } | { error: string }): Suggestion {
  if ("error" in m) return { ...rules, warnings: [...rules.warnings, `Model judge unavailable (${m.error}). Rules only.`], model: { code: null, confidence: 0, reason: "", model: "", error: m.error } };
  const modelPick = m.choice > 0 ? rules.picks[m.choice - 1] : null;
  const info = { code: modelPick?.code ?? null, confidence: m.confidence, reason: m.reason, model: m.model };
  const rulesTop = rules.picks[0];
  const sameAsRules = modelPick && rulesTop && normCode(modelPick.code) === normCode(rulesTop.code) && normDesc(modelPick.description) === normDesc(rulesTop.description);

  if (rules.decision === "new") {
    if (!modelPick) return { ...rules, judged_by: "rules+claude", model: info, reason: `${rules.reason} Claude agrees: ${m.reason}` };
    return { ...rules, decision: "review", judged_by: "rules+claude", model: info, reason: `Rules propose a new code, but Claude chose ${modelPick.code}: ${m.reason}` };
  }
  if (rules.decision === "auto" && sameAsRules && m.confidence >= 0.8 && !m.site_code_means_something_else)
    return { ...rules, judged_by: "rules+claude", confidence: Math.round(((rules.confidence + m.confidence) / 2) * 100) / 100, model: info, reason: `${rules.reason} Claude agrees: ${m.reason}` };

  const why: string[] = [];
  if (!modelPick) why.push(`Claude found no fitting code: ${m.reason}`);
  else if (!sameAsRules) why.push(`Rules prefer ${rulesTop?.code}, Claude prefers ${modelPick.code}: ${m.reason}`);
  else if (m.confidence < 0.8) why.push(`Claude is not sure (${m.confidence.toFixed(2)}): ${m.reason}`);
  if (m.site_code_means_something_else) why.push("Claude says the site code means something else in the master.");
  // Show the model's choice first so the engineer sees it.
  const picks = modelPick ? [modelPick, ...rules.picks.filter(p => p !== modelPick)] : rules.picks;
  return { ...rules, decision: "review", judged_by: "rules+claude", model: info, picks, reason: [rules.decision === "review" ? rules.reason : "", ...why].filter(Boolean).join(" | ") };
}
