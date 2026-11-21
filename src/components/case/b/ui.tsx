import type { CSSProperties, ReactNode } from "react";

/** Minimal shared styling for B's panels until the app adopts Tailwind/shadcn (PLAN.md section 10). */
export const s = {
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13 } as CSSProperties,
  th: { textAlign: "left", borderBottom: "2px solid #ddd", padding: "6px 8px", whiteSpace: "nowrap", fontWeight: 600 } as CSSProperties,
  td: { borderBottom: "1px solid #eee", padding: "6px 8px", verticalAlign: "top" } as CSSProperties,
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as CSSProperties,
  muted: { color: "#666", fontSize: 12 } as CSSProperties,
  card: { border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fff" } as CSSProperties,
  button: { padding: "4px 10px", border: "1px solid #999", borderRadius: 6, background: "#f7f7f7", cursor: "pointer", fontSize: 13 } as CSSProperties,
  primary: { padding: "6px 12px", border: "1px solid #1d4ed8", borderRadius: 6, background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 13 } as CSSProperties,
};

const TONES = {
  info: { background: "#eef2ff", color: "#3730a3" },
  warn: { background: "#fef3c7", color: "#92400e" },
  block: { background: "#fee2e2", color: "#991b1b" },
  ok: { background: "#dcfce7", color: "#166534" },
  plain: { background: "#f1f5f9", color: "#334155" },
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "plain", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} style={{ ...TONES[tone], borderRadius: 999, padding: "1px 8px", fontSize: 12, marginRight: 4, display: "inline-block", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
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
