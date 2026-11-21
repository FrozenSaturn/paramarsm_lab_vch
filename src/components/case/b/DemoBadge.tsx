import type { CSSProperties } from "react";

/** A row is demo data when the seed made it up (PLAN.md section 12). */
export function isDemoRow(row: { is_demo?: boolean | null; source?: string | null } | null | undefined): boolean {
  if (!row) return false;
  return row.is_demo === true || row.source === "demo";
}

const pill: CSSProperties = {
  background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 999,
  padding: "1px 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3,
  marginLeft: 4, display: "inline-block", whiteSpace: "nowrap", cursor: "help",
};

const DEFAULT_TITLE = "Demo data: this record is made up for the demo. It is not a real rating or a real event.";

/** Shows an amber "demo data" pill. Shows nothing when `show` is false. */
export function DemoBadge({ show, title = DEFAULT_TITLE }: { show: boolean; title?: string }) {
  if (!show) return null;
  return <span style={pill} title={title} aria-label={title}>demo data</span>;
}
