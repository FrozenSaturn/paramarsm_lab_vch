import Link from "next/link";
import type { CSSProperties } from "react";
import { compareNow } from "@/compare/actions";
import { listComparatives, loadComparative } from "@/compare/stored";
import type { Matrix, MatrixCell } from "@/compare/types";
import { fmtINR, fmtNum } from "@/quotes/format";
import { PARAMS, PARAM_LABELS, type VendorScore } from "@/scoring/types";
import { Badge, Flags, s, type Tone } from "./ui";

const lowestBg: CSSProperties = { background: "#dcfce7" };
const missingBg: CSSProperties = { background: "#fff7ed" };
const right: CSSProperties = { ...s.td, ...s.num };
const TERM_TONE: Record<string, Tone> = { met: "ok", not_met: "block", not_stated: "plain" };
const TERM_LABEL: Record<string, string> = { met: "met", not_met: "not met", not_stated: "not stated" };
const RISK_LABELS: Record<string, string> = {
  stale: "Stale", different_scope: "Different scope", far_below_median: "Far below median", unconfirmed_handwriting: "Handwriting unconfirmed",
  validity_lapsed: "Validity lapsed", lines_missing: "Lines missing", fewer_than_three: "Fewer than three",
};
const TRIGGER_LABELS: Record<string, string> = {
  button: "the Compare now button", all_quoted: "all vendors quoted", due_date: "the due date", revised_quote: "a revised quote", script: "a script",
};
const pct = (r: number) => `${fmtNum(Math.round(r * 10000) / 100)}%`;
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function CompareNowButton({ caseId }: { caseId: string }) {
  return (
    <form action={compareNow} style={{ display: "inline" }}>
      <input type="hidden" name="case_id" value={caseId} />
      <button style={s.primary}>Compare now</button>
    </form>
  );
}

/** One matrix cell: rate in the row's unit and amount on Vinayak's quantity. */
function Cell({ c, unit }: { c: MatrixCell; unit: string | null }) {
  const printed = c.rate_raw != null ? `Printed: ₹${fmtNum(c.rate_raw)} per ${c.unit_raw ?? "?"}${c.page ? `, page ${c.page}` : ""}` : "Not in the quote";
  if (c.missing) {
    const what = c.flags.some((f) => f.code === "not_quoted") ? "not quoted" : "not comparable";
    const title = `${printed}. ${c.loaded_amount != null ? `Loaded at ${fmtINR(c.loaded_amount)} (highest other amount on this line) for the price comparison.` : "No loading."}`;
    return (
      <>
        <td style={{ ...right, ...missingBg }} title={title}>{c.rate_raw != null ? `${fmtNum(c.rate_raw)}/${c.unit_raw ?? "?"}` : "—"}</td>
        <td style={{ ...right, ...missingBg }} title={title}>
          <Badge tone="warn">{what}</Badge>
          {c.loaded_amount != null && <div style={s.muted}>loaded {fmtINR(c.loaded_amount)}</div>}
        </td>
      </>
    );
  }
  const bg = c.lowest ? lowestBg : undefined;
  return (
    <>
      <td style={{ ...right, ...bg }} title={`${printed}. Rate per ${unit ?? "unit"}: ₹${fmtNum(c.rate)}`}>
        {fmtNum(c.rate)}
        {c.handwritten && <div><Badge tone={c.confirmed ? "ok" : "block"} title={c.confirmed ? "Handwritten rate, confirmed by a person" : "Handwritten rate, not confirmed"}>{c.confirmed ? "hw ✓" : "hw ?"}</Badge></div>}
      </td>
      <td style={{ ...right, ...bg }}>{fmtINR(c.amount)}</td>
    </>
  );
}

function MatrixTable({ m }: { m: Matrix }) {
  const vs = m.vendors;
  const totalRow = (label: string, render: (vendorId: string) => React.ReactNode, strong = false) => (
    <tr>
      <td style={{ ...s.td, fontWeight: strong ? 700 : 600 }} colSpan={4}>{label}</td>
      {vs.map((v) => <td key={v.vendor_id} style={{ ...right, fontWeight: strong ? 700 : 400 }} colSpan={2}>{render(v.vendor_id)}</td>)}
    </tr>
  );
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th} rowSpan={2}>S.No</th><th style={s.th} rowSpan={2}>Description</th><th style={s.th} rowSpan={2}>Unit</th>
            <th style={{ ...s.th, ...s.num }} rowSpan={2}>Vinayak's qty</th>
            {vs.map((v) => (
              <th key={v.vendor_id} style={{ ...s.th, textAlign: "center" }} colSpan={2}>
                {v.name}
                <div style={{ ...s.muted, fontWeight: 400 }}>v{v.version}{v.status === "needs_review" ? " · needs review" : ""}</div>
              </th>
            ))}
          </tr>
          <tr>
            {vs.map((v) => [
              <th key={`${v.vendor_id}-r`} style={{ ...s.th, ...s.num }}>Rate</th>,
              <th key={`${v.vendor_id}-a`} style={{ ...s.th, ...s.num }}>Amount</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.serial}>
              <td style={s.td}>{r.serial}</td>
              <td style={{ ...s.td, maxWidth: 320 }}>{r.description}</td>
              <td style={s.td}>{r.unit ?? "—"}</td>
              <td style={right}>{fmtNum(r.quantity)}</td>
              {vs.map((v) => <Cell key={v.vendor_id} c={r.cells[v.vendor_id]} unit={r.unit} />)}
            </tr>
          ))}
          {totalRow("Total before GST", (id) => (
            <>{fmtINR(m.totals[id].before_gst)}<div style={s.muted}>{m.totals[id].lines_priced} of {m.rows.length} lines priced</div></>
          ), true)}
          {totalRow("GST", (id) => {
            const t = m.totals[id];
            const basis = t.gst_basis === "assumed_standard" ? "not stated, assumed" : t.gst_basis === "inclusive" ? "included in rates" : "extra";
            return <>{fmtINR(t.gst)}<div style={s.muted}>{pct(t.gst_rate)} · {basis}</div></>;
          })}
          {totalRow("Landed (before GST + GST)", (id) => fmtINR(m.totals[id].landed), true)}
          {totalRow("Loading for missing lines", (id) => (
            m.totals[id].loading ? <span title={`Lines ${m.totals[id].lines_missing.join(", ")}`}>{fmtINR(m.totals[id].loading)}</span> : "—"
          ))}
          {totalRow("Landed for price = (before GST + loading) × (1 + GST)", (id) => (
            <span style={id === m.lowest_landed_vendor_id ? { ...lowestBg, padding: "2px 6px", borderRadius: 4 } : undefined}>
              {fmtINR(m.totals[id].landed_for_price)}{id === m.lowest_landed_vendor_id ? " · lowest" : ""}
            </span>
          ), true)}
          <tr><td colSpan={4 + vs.length * 2} style={{ ...s.td, fontWeight: 600, background: "#f8fafc" }}>RFQ terms</td></tr>
          {m.terms.map((t) => (
            <tr key={t.term}>
              <td style={s.td} colSpan={4}>{t.label}</td>
              {vs.map((v) => {
                const c = t.cells[v.vendor_id];
                return <td key={v.vendor_id} style={s.td} colSpan={2}><Badge tone={TERM_TONE[c.status]} title={c.detail ?? undefined}>{TERM_LABEL[c.status]}</Badge></td>;
              })}
            </tr>
          ))}
          <tr>
            <td style={{ ...s.td, fontWeight: 600 }} colSpan={4}>Quote flags</td>
            {vs.map((v) => <td key={v.vendor_id} style={s.td} colSpan={2}><Flags flags={v.flags} hideInfo /></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ScoresTable({ m, scores, weights }: { m: Matrix; scores: VendorScore[]; weights: Record<string, number> }) {
  const name = (id: string) => m.vendors.find((v) => v.vendor_id === id)?.name ?? id.slice(0, 8);
  const ordered = [...scores].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Rank</th><th style={s.th}>Vendor</th><th style={{ ...s.th, ...s.num }}>Total</th>
            {PARAMS.map((p) => <th key={p} style={{ ...s.th, ...s.num }}>{PARAM_LABELS[p]}<div style={{ ...s.muted, fontWeight: 400 }}>weight {fmtNum(weights[p])}</div></th>)}
            <th style={s.th}>Risk flags (beside the score)</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((sc) => (
            <tr key={sc.vendor_id}>
              <td style={s.td}>{sc.rank ?? <span style={s.muted}>withheld</span>}</td>
              <td style={s.td}>{name(sc.vendor_id)}</td>
              <td style={{ ...right, fontWeight: 700 }}>{fmtNum(sc.total)}</td>
              {PARAMS.map((p) => {
                const ps = sc.params.find((x) => x.param === p);
                if (!ps) return <td key={p} style={right}>—</td>;
                return (
                  <td key={p} style={right} title={ps.explain}>
                    <span style={ps.neutral ? { color: "#666" } : undefined}>{fmtNum(ps.score)}</span>
                    <div style={s.muted}>× {fmtNum(ps.weight)}% = {fmtNum(ps.contribution)}</div>
                    {ps.label && <div><Badge tone={ps.label === "demo data" ? "info" : "plain"}>{ps.label}</Badge></div>}
                  </td>
                );
              })}
              <td style={s.td}>
                {sc.risk_flags.length
                  ? sc.risk_flags.map((f, i) => <Badge key={i} tone={f.severity} title={f.message}>{RISK_LABELS[f.code] ?? f.code}</Badge>)
                  : <span style={s.muted}>none</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={s.muted}>Total = Σ weight × score ÷ 100. Each parameter scores 0–100; a missing input scores a neutral 50 with a label. Hover a score for how it was worked out.</p>
    </div>
  );
}

/**
 * The comparative statement for a case (W6): matrix, totals, terms, flags, scores and notes,
 * as stored. Server component; mounted on /dev/quotes and later the case Comparative tab.
 */
export async function ComparativePanel({ caseId, version, versionHref }: { caseId: string; version?: number; versionHref?: (version: number) => string }) {
  const versions = await listComparatives(caseId);
  const pick = (version != null ? versions.find((v) => v.version === version) : undefined) ?? versions[0];
  const c = pick ? await loadComparative(pick.id) : null;

  return (
    <section style={{ ...s.card, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Comparative</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {c && <a href={`/api/b/comparatives/${c.id}/excel`} style={s.button}>Excel</a>}
          <CompareNowButton caseId={caseId} />
        </div>
      </div>
      {!c && <p style={s.muted}>No comparative yet. W6 builds one when all invited vendors have quoted, at the due date with three or more quotes, or when you press Compare now.</p>}
      {c && (
        <>
          <p style={s.muted}>
            v{c.version} of {versions.length}, built {fmtTime(c.created_at)} by {TRIGGER_LABELS[c.trigger ?? ""] ?? c.trigger ?? "—"}
            {" · "}as of {c.matrix.as_of ?? "—"} · weights “{c.category ?? "default"}” · inputs {c.inputs_hash?.slice(0, 12) ?? "—"}
            {versions.length > 1 && versionHref && (
              <> · versions:{" "}
                {versions.map((v) => (
                  <Link key={v.id} href={versionHref(v.version)} style={{ marginRight: 6, fontWeight: v.version === c.version ? 700 : 400 }}>v{v.version}</Link>
                ))}
              </>
            )}
          </p>
          {c.matrix.ranking_withheld && (
            <p style={{ ...s.card, background: "#fef3c7", color: "#92400e" }}>
              Ranking withheld: fewer than three quotes. The SOP needs three before a ranking. Scores are shown for information.
            </p>
          )}
          <MatrixTable m={c.matrix} />
          <h3>Scores</h3>
          <ScoresTable m={c.matrix} scores={c.scores} weights={c.weights} />
          {c.matrix.notes.length > 0 && (
            <>
              <h3>Notes</h3>
              <ul style={{ fontSize: 13, marginTop: 0 }}>{c.matrix.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </>
          )}
          <p style={s.muted}>Amount = rate in the row's unit × Vinayak's quantity, 2 places. Green = lowest on the line. Hover a rate for the printed rate and page.</p>
        </>
      )}
    </section>
  );
}
