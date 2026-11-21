import type { ReactNode } from "react";

/** Shared page pieces for the DESIGN.md look. Styles live in app/globals.css. */
export function PageHead({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Panel({ title, meta, children, flush }: { title: ReactNode; meta?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head"><h3>{title}</h3>{meta && <span className="muted">{meta}</span>}</div>
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

export type BadgeTone = "plain" | "ok" | "warn" | "block" | "info";
export function Pill({ tone = "plain", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge${tone === "plain" ? "" : ` badge-${tone}`}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

const STAGE_TONE: Record<string, BadgeTone> = { done: "ok", closed: "ok", approved: "ok", open: "info", new: "info", blocked: "block", failed: "block" };
export const stageTone = (s: string | null | undefined): BadgeTone => STAGE_TONE[(s ?? "").toLowerCase()] ?? "plain";
export const label = (s: string | null | undefined) => (s ?? "unknown").replace(/_/g, " ");
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
