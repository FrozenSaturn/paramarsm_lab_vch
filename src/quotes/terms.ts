/**
 * Vinayak's six standard RFQ terms (03_tender/Sample_RFQ_email_to_a_vendor.txt).
 * The RFQ row's `terms` (A's table) overrides the text when present; the keys stay fixed
 * because quote_terms.term and the comparative's terms grid use them.
 */
export const TERM_KEYS = ["pf_esi", "tds", "security_deposit", "gst_extra", "site_facilities", "safety_ppe"] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type TermStatus = "met" | "not_met" | "not_stated";

export const DEFAULT_TERMS: Record<TermKey, { label: string; text: string }> = {
  pf_esi: { label: "PF & ESI", text: "PF & ESI registration required." },
  tds: { label: "TDS", text: "TDS will be deducted as per Govt. norms." },
  security_deposit: { label: "Security deposit", text: "5% Security deposit will be released after 12 months of total completion of work." },
  gst_extra: { label: "GST extra", text: "GST will be paid extra." },
  site_facilities: { label: "Site facilities", text: "Water & Electricity at a point and Labour hutment will be provided (nothing more is provided by Vinayak)." },
  safety_ppe: { label: "Safety PPE", text: "Safety PPE cost will be under Contractor's scope." },
};

/**
 * Accepts whatever shape A stores in rfqs.terms: an array of { id, text } (src/lib/rfq-terms.ts),
 * an array of strings in the standard order, or an object keyed by TermKey. Anything else keeps the defaults.
 */
export function termsFromRfq(raw: unknown): Record<TermKey, { label: string; text: string }> {
  const out = structuredClone(DEFAULT_TERMS);
  if (Array.isArray(raw)) {
    raw.slice(0, 12).forEach((t, i) => {
      const id = (t as any)?.id;
      const key = (TERM_KEYS as readonly string[]).includes(id) ? (id as TermKey) : typeof t === "string" ? TERM_KEYS[i] : undefined;
      const text = typeof t === "string" ? t : (t as any)?.text;
      if (key && typeof text === "string" && text.trim()) out[key].text = text.trim();
    });
  } else if (raw && typeof raw === "object") {
    for (const k of TERM_KEYS) {
      const v = (raw as any)[k];
      const text = typeof v === "string" ? v : v?.text;
      if (typeof text === "string" && text.trim()) out[k].text = text.trim();
    }
  }
  return out;
}
