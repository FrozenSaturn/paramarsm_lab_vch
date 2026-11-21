/**
 * Turns a quote's stored reading (quotes.extraction) into page texts for search.
 * Used for pages that have no text layer, such as SK's scan, and for handwritten rates
 * that OCR does not read. Pure code: each passage keeps the page that the reader gave.
 */
import { HEADER_FIELDS } from "@/quotes/schema";

interface Located { page?: number | null; snippet?: string | null }
interface FieldLike extends Located { value?: string | null }
interface LineLike extends Located {
  serial?: string; item?: string; unit?: string; quantity?: number | null; rate?: number | null;
  amount?: number | null; make?: string | null; rate_handwritten?: boolean;
}
interface ExtractionLike {
  header?: Partial<Record<string, FieldLike>>;
  lines?: LineLike[];
  terms?: (Located & { term?: string; status?: string; detail?: string })[];
  stated_totals?: (Located & { label?: string; amount?: number })[];
  vendor_conditions?: { text?: string; page?: number | null }[];
  is_scanned?: boolean;
}

const LABELS: Record<string, string> = {
  vendor_name: "Vendor", gstin: "GSTIN", quote_date: "Quote date", reference: "Reference", validity: "Validity",
  gst_treatment: "GST", freight: "Freight", payment_terms: "Payment terms", advance: "Advance",
  security_deposit: "Security deposit", pf_esi: "PF and ESI", completion_time: "Completion time",
  mobilisation: "Mobilisation", warranty: "Warranty", exclusions: "Exclusions",
};

const quoted = (s?: string | null) => (s && s.trim() ? ` (printed: "${s.trim()}")` : "");

/** One sentence per value. Values without a page go to page null. */
export function extractionPassages(extraction: unknown, opts: { onlyPages?: Set<number> | null; linesOnly?: boolean } = {}) {
  const e = (extraction ?? {}) as ExtractionLike;
  const items: { page: number | null; text: string }[] = [];
  const keep = (page: number | null | undefined) => !opts.onlyPages || (page != null && opts.onlyPages.has(page));

  if (!opts.linesOnly) {
    for (const key of HEADER_FIELDS) {
      const f = e.header?.[key];
      if (!f?.value || !keep(f.page)) continue;
      items.push({ page: f.page ?? null, text: `${LABELS[key] ?? key}: ${f.value}${quoted(f.snippet !== f.value ? f.snippet : null)}.` });
    }
  }
  for (const l of e.lines ?? []) {
    if (!keep(l.page)) continue;
    const parts = [
      `Line ${l.serial ?? "?"}: ${l.item ?? "item"}`,
      l.rate != null ? `rate ${l.rate}${l.unit ? ` per ${l.unit}` : ""}${l.rate_handwritten ? " (handwritten)" : ""}` : "no rate",
      l.quantity != null ? `quantity ${l.quantity}${l.unit ? ` ${l.unit}` : ""}` : null,
      l.amount != null ? `amount ${l.amount}` : null,
      l.make ? `make ${l.make}` : null,
    ].filter(Boolean);
    items.push({ page: l.page ?? null, text: `${parts.join(", ")}${quoted(l.snippet)}.` });
  }
  if (!opts.linesOnly) {
    for (const t of e.terms ?? []) {
      if (!t.detail || /^not mentioned$/i.test(t.detail.trim()) || !keep(t.page)) continue;
      items.push({ page: t.page ?? null, text: `Term ${t.term}: ${t.detail}${quoted(t.snippet)}.` });
    }
    for (const t of e.stated_totals ?? []) {
      if (t.amount == null || !keep(t.page)) continue;
      items.push({ page: t.page ?? null, text: `${t.label ?? "Total"}: ${t.amount}${quoted(t.snippet)}.` });
    }
    for (const c of e.vendor_conditions ?? []) {
      if (!c.text || !keep(c.page)) continue;
      items.push({ page: c.page ?? null, text: `Vendor condition: ${c.text}.` });
    }
  }

  // Group by page, in page order (null last), one text per page.
  const byPage = new Map<number | null, string[]>();
  for (const it of items) byPage.set(it.page, [...(byPage.get(it.page) ?? []), it.text]);
  return [...byPage.entries()]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([page, texts]) => ({ page, text: texts.join("\n") }));
}
