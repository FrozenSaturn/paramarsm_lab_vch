import Link from "next/link";
import { Badge, s, type Tone } from "./ui";
import { loadAuditCases, loadAuditTimeline, shortHash, type AuditFilter, type AuditItem, type AuditQuery } from "./audit-data";

const TYPE_TONE: Record<AuditItem["type"], Tone> = { event: "plain", step: "info", action: "ok", decision: "warn" };
const TYPES: AuditFilter[] = ["all", "event", "step", "action", "decision"];

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** Audit timeline (server). A GET form filters it, so the URL holds the filter. */
export default async function AuditTimeline({ query }: { query: AuditQuery }) {
  const [items, cases] = await Promise.all([loadAuditTimeline(query), loadAuditCases()]);
  return (
    <div>
      <form method="get" action="/audit" style={{ ...s.card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={s.muted}>
          Case<br />
          <select name="case" defaultValue={query.caseId ?? ""}>
            <option value="">All cases</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label style={s.muted}>
          Type<br />
          <select name="type" defaultValue={query.type ?? "all"}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={s.muted}>
          Who<br />
          <input name="actor" defaultValue={query.actor ?? ""} placeholder="email or agent" />
        </label>
        <button type="submit" style={s.primary}>Filter</button>
        <Link href="/audit" style={s.muted}>Clear</Link>
      </form>

      <p style={s.muted}>{items.length} entries, newest first.</p>
      {items.length === 0 ? (
        <p style={s.muted}>No entries match this filter.</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Time</th><th style={s.th}>Type</th><th style={s.th}>Who</th><th style={s.th}>What</th>
              <th style={s.th}>Why</th><th style={s.th}>Proof</th><th style={s.th}>Links</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} style={i.override ? { background: "#fffbeb" } : undefined}>
                <td style={{ ...s.td, whiteSpace: "nowrap" }}>{fmt(i.at)}</td>
                <td style={s.td}>
                  <Badge tone={TYPE_TONE[i.type]}>{i.type}</Badge>
                  {i.override && <Badge tone="block">override</Badge>}
                </td>
                <td style={s.td}>{i.who}</td>
                <td style={s.td}>{i.what}</td>
                <td style={{ ...s.td, maxWidth: 360 }}>
                  {i.why ? (i.override ? <strong>{i.why}</strong> : i.why) : <span style={s.muted}>-</span>}
                </td>
                <td style={s.td}>
                  {i.proof ? (
                    <span title={i.proof.payload_hash}>
                      <code>{shortHash(i.proof.payload_hash)}</code>
                      {i.proof.provider_id && <div style={s.muted}>{i.proof.provider_id}</div>}
                    </span>
                  ) : <span style={s.muted}>-</span>}
                </td>
                <td style={s.td}>
                  {i.links.map((k, n) => (
                    <div key={n}><Link href={k.href}>{k.label}</Link></div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
