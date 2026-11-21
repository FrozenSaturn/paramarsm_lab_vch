import type { CSSProperties, ReactNode } from "react";

/** Shared styling for B's panels. Values are DESIGN.md tokens from app/globals.css, so the panels follow the theme. */
export const s = {
  table: { width: "100%", fontSize: 13 } as CSSProperties,
  th: { textAlign: "left" } as CSSProperties,
  td: {} as CSSProperties,
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as CSSProperties,
  muted: { color: "var(--ink-subtle)", fontSize: 12 } as CSSProperties,
  card: { border: "1px solid var(--hairline)", borderRadius: 12, padding: 16, marginBottom: 16, background: "var(--surface-1)" } as CSSProperties,
  button: {} as CSSProperties,
  primary: { background: "var(--primary)", borderColor: "var(--primary)", color: "var(--on-primary)" } as CSSProperties,
};

const TONES = { info: "badge-info", warn: "badge-warn", block: "badge-block", ok: "badge-ok", plain: "" } as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "plain", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`badge ${TONES[tone]}`} style={{ marginRight: 4 }}>{children}</span>;
}

export const statusTone = (status: string): Tone =>
  status === "ready" ? "ok" : status === "needs_review" ? "warn" : status === "failed" ? "block" : "plain";

export const FLAG_LABELS: Record<string, string> = {
  stale: "Stale", validity_expired: "Validity lapsed", undated: "Undated", different_scope: "Different scope",
  scope_matches: "BOQ quantities", scope_close: "Close to BOQ", handwriting: "Handwritten", total_mismatch: "Total differs",
  totals_agree: "Totals agree", missing_lines: "Lines missing", lines_not_comparable: "Not comparable", gst_not_stated: "GST not stated",
  gst_inclusive: "GST included", unit_mismatch: "Unit differs", unit_converted: "Converted", qty_differs: "Qty differs",
  qty_close: "Qty close", arithmetic: "Arithmetic", vendor_arithmetic: "Vendor arithmetic", handwritten: "Handwritten", reads_disagree: "Reads disagree",
  low_confidence: "Low confidence", no_rate: "No rate", unmatched: "Unmatched", duplicate_line: "Duplicate", unit_unknown: "Unknown unit",
  confirmed: "Confirmed",
};

export function Flags({ flags, hideInfo = false }: { flags: { code: string; severity: "info" | "warn" | "block"; message: string }[]; hideInfo?: boolean }) {
  return (
    <>
      {flags.filter((f) => !hideInfo || f.severity !== "info").map((f, i) => (
        <Badge key={i} tone={f.severity} title={f.message}>{FLAG_LABELS[f.code] ?? f.code}</Badge>
      ))}
    </>
  );
}
