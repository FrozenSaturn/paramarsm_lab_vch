/**
 * Pure helpers for getContext: bounds, ordering and the text of each fact.
 * No database here, so the tests run offline.
 */
import type { ContextItem, ContextPack } from "@/contracts/context";
import { fmtDate, fmtINR, fmtNum } from "@/quotes/format";

export const LIMITS = { facts: 40, passages: 8, memories: 8 } as const;
export const MAX_ITEM_CHARS = 700;

export const emptyPack = (): ContextPack => ({ facts: [], passages: [], memories: [] });

/** Shortens text to n characters at a word boundary and adds an ellipsis. */
export function clip(text: string, n = MAX_ITEM_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + "…";
}

/**
 * Keeps items that have text and a source id, removes repeated source ids, clips the text,
 * and keeps the first `max`. The input order is the priority order.
 */
export function bound(items: ContextItem[], max: number, maxChars = MAX_ITEM_CHARS): ContextItem[] {
  const seen = new Set<string>();
  const out: ContextItem[] = [];
  for (const it of items) {
    if (out.length >= max) break;
    if (!it?.text?.trim() || !it.source_id || seen.has(it.source_id)) continue;
    seen.add(it.source_id);
    out.push({ text: clip(it.text, maxChars), source_id: it.source_id, source_type: it.source_type });
  }
  return out;
}

/**
 * Joins fact groups in priority order. Each group first gets up to `share` items, so a long
 * group (BOQ lines) cannot push out the short ones; the rest fills what is left.
 */
export function mergeFacts(groups: ContextItem[][], max: number = LIMITS.facts, share = 6): ContextItem[] {
  const first = groups.flatMap((g) => g.slice(0, share));
  const rest = groups.flatMap((g) => g.slice(share));
  return bound([...first, ...rest], max);
}

/** Sorts by score, highest first, keeping the input order for equal scores. */
export function byScoreDesc<T extends { score?: number | null }>(items: T[]): T[] {
  return items.map((x, i) => [x, i] as const).sort((a, b) => (b[0].score ?? 0) - (a[0].score ?? 0) || a[1] - b[1]).map(([x]) => x);
}

/** The latest quote version per vendor, without failed, superseded or unread quotes. */
export function liveQuotes<T extends { vendor_id: string; version: number | null; status: string | null }>(quotes: T[]): T[] {
  const best = new Map<string, T>();
  for (const q of quotes) {
    if (["superseded", "failed", "extracting"].includes(q.status ?? "")) continue;
    const cur = best.get(q.vendor_id);
    if (!cur || (q.version ?? 0) > (cur.version ?? 0)) best.set(q.vendor_id, q);
  }
  return [...best.values()];
}

// ---------- fact text ----------

const n = (x: unknown) => (x == null || x === "" ? null : Number(x));

export function boqLineFact(l: { serial: string | null; description: string; unit: string | null; quantity: unknown; item_code: string | null }, version: { version: number; status: string | null }) {
  const qty = n(l.quantity);
  const parts = [`BOQ v${version.version} (${version.status ?? "draft"}) line ${l.serial ?? "?"}: ${l.description}`];
  parts.push(qty == null ? "quantity not measured" : `${fmtNum(qty)} ${l.unit ?? ""}`.trim());
  if (l.item_code) parts.push(`item code ${l.item_code}`);
  return parts.join(", ");
}

export function rfqFact(r: { ref: string | null; status: string | null; due_date: string | null }, recipients: { name: string; sent_at: string | null; status: string | null }[]) {
  const sent = recipients.map((x) => `${x.name} (${x.sent_at ? `sent ${fmtDate(x.sent_at)}` : x.status ?? "draft"})`);
  return `RFQ ${r.ref ?? "(no ref)"}: status ${r.status ?? "draft"}, due ${fmtDate(r.due_date)}. Recipients: ${sent.length ? sent.join(", ") : "none"}.`;
}

export function quoteFact(q: {
  version: number | null; status: string | null; total_on_boq: unknown; comparable_lines: number | null; scope: string | null;
  quote_date: string | null; valid_until: string | null; payment_terms: string | null; completion_time: string | null; flags: unknown;
}, vendor: string) {
  const flags = Array.isArray(q.flags) ? (q.flags as { code?: string; severity?: string }[]).filter((f) => f.severity !== "info").map((f) => f.code).filter(Boolean) : [];
  const parts = [
    `Quote from ${vendor} (v${q.version ?? 1}, ${q.status ?? "?"}): ${fmtINR(n(q.total_on_boq))} before GST on Vinayak's BOQ quantities` +
      (q.comparable_lines != null ? ` over ${q.comparable_lines} lines` : ""),
    `scope ${q.scope ?? "unknown"}`,
    `dated ${fmtDate(q.quote_date)}`,
  ];
  if (q.valid_until) parts.push(`valid until ${fmtDate(q.valid_until)}`);
  if (q.payment_terms) parts.push(`payment: ${q.payment_terms}`);
  if (q.completion_time) parts.push(`completion: ${q.completion_time}`);
  if (flags.length) parts.push(`flags: ${flags.join(", ")}`);
  return parts.join("; ") + ".";
}

export function scoreFact(s: { rank: number | null; total: unknown }, vendor: string, version: number, landed: number | null) {
  return `Comparative v${version}: ${vendor} ranks ${s.rank ?? "?"} with score ${fmtNum(n(s.total))} of 100` +
    (landed != null ? `; landed total ${fmtINR(landed)}` : "") + ".";
}

export function performanceFact(p: { quality: number | null; timeliness: number | null; disputes: number | null; safety: number | null; note: string | null; source: string | null; is_demo: boolean | null }, vendor: string) {
  const r = (["quality", "timeliness", "disputes", "safety"] as const).filter((k) => p[k] != null).map((k) => `${k} ${p[k]}/5`);
  const label = p.is_demo ? "demo data" : p.source === "confirmed" ? "confirmed by a person" : p.source ?? "record";
  return `Past performance of ${vendor} (${label}): ${r.join(", ") || "no ratings"}` + (p.note ? `. ${p.note}` : "") + ".";
}
