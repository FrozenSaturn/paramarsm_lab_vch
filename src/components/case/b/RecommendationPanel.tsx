/**
 * W6/W7 recommendation panel (server). Loads one recommendation, its comparative scores,
 * vendor names and the decision. Resolves each fact proof to a link on the server, then
 * passes plain data to RecommendationClient ("what if" and the HOD decision form).
 */
import { getUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { loadComparative } from "@/compare/stored";
import { documentPageUrl } from "@/quotes/source";
import { fmtNum } from "@/quotes/format";
import type { Explanation, ExplanationSentence } from "@/agents/b/explain-check";
import type { RecommendationFact } from "@/compare/recommend-facts";
import type { RankingEntry } from "@/compare/recommend";
import { Badge, s, type Tone } from "./ui";
import { RecommendationClient, type DecisionView } from "./RecommendationClient";

const STATUS_TONE: Record<string, Tone> = { draft: "plain", with_hod: "warn", decided: "ok", sent_back: "block", superseded: "plain" };
const STATUS_LABEL: Record<string, string> = { draft: "Draft", with_hod: "With HOD", decided: "Decided", sent_back: "Sent back", superseded: "Superseded" };

/** A link for one fact proof, or null when there is no target. */
async function proofHref(f: RecommendationFact): Promise<string | null> {
  const p = f.proof;
  switch (p.type) {
    case "pdf_page": return p.document_id ? documentPageUrl(p.document_id, p.page ?? null) : null;
    case "performance": return f.vendor_id ? `/vendors/${f.vendor_id}` : null;
    case "comparative": return "#comparative";
    case "quote": return p.quote_id ? `/dev/quotes/${p.quote_id}` : null;
    default: return null;
  }
}

function Sentence({ sent, links, titles }: { sent: ExplanationSentence; links: Record<string, string | null>; titles: Record<string, string> }) {
  return (
    <li style={{ marginBottom: 4 }}>
      {sent.text}{" "}
      {sent.fact_ids.map((id) => {
        const href = links[id];
        const style = { fontSize: 11, marginRight: 4, color: "#2563eb" };
        return href
          ? <a key={id} href={href} title={titles[id]} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer" style={style}>[{id}]</a>
          : <span key={id} title={titles[id]} style={{ ...style, color: "#666" }}>[{id}]</span>;
      })}
    </li>
  );
}

export async function RecommendationPanel(props: { recommendationId?: string; caseId?: string; highlight?: boolean }) {
  const db = admin();
  const cols = "id,case_id,comparative_id,ranking,explanation,facts,status,top_vendor_id,created_at,model";
  let q = db.from("recommendations").select(cols);
  if (props.recommendationId) q = q.eq("id", props.recommendationId);
  else if (props.caseId) q = q.eq("case_id", props.caseId).neq("status", "superseded").order("created_at", { ascending: false }).limit(1);
  else return null;
  const { data: rows, error } = await q;
  if (error) return <div style={s.card}>Could not load the recommendation: {error.message}</div>;
  const rec = rows?.[0] as any;
  if (!rec) return <div id="recommendation" style={s.card}><h3 style={{ marginTop: 0 }}>Recommendation</h3><span style={s.muted}>No recommendation yet.</span></div>;

  const [cmp, user, { data: decRows }] = await Promise.all([
    loadComparative(rec.comparative_id),
    getUser(),
    db.from("decisions").select("kind,vendor_id,reason,created_at,decided_by,overridden").eq("recommendation_id", rec.id).limit(1),
  ]);
  const explanation = (rec.explanation ?? { summary: [], vendors: [] }) as Explanation;
  const facts = (rec.facts ?? []) as RecommendationFact[];
  const ranking = (rec.ranking ?? []) as RankingEntry[];

  // Vendor names: from the matrix, then the ranking.
  const names: Record<string, string> = {};
  for (const v of cmp?.matrix.vendors ?? []) names[v.vendor_id] = v.name;
  for (const r of ranking) names[r.vendor_id] ??= r.name;
  const name = (id: string | null | undefined) => (id ? names[id] ?? id.slice(0, 8) : "—");

  // Resolve proofs on the server.
  const links: Record<string, string | null> = {};
  const titles: Record<string, string> = {};
  await Promise.all(facts.map(async (f) => { links[f.id] = await proofHref(f).catch(() => null); titles[f.id] = f.text; }));

  let decision: DecisionView | null = null;
  const d = decRows?.[0] as any;
  if (d) {
    const { data: who } = await db.from("profiles").select("email").eq("id", d.decided_by).maybeSingle();
    decision = { kind: d.kind, vendorName: d.vendor_id ? name(d.vendor_id) : null, reason: d.reason ?? null, at: d.created_at ?? null, by: (who as any)?.email ?? d.decided_by };
  }

  const scores = cmp?.scores ?? [];
  const scoreOf = new Map(scores.map((x) => [x.vendor_id, x]));
  const top3 = ranking.filter((r) => r.rank != null).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 3);
  const reasonsOf = new Map(explanation.vendors.map((v) => [v.vendor_id, v.reasons]));
  const canDecide = user?.role === "hod" && rec.status === "with_hod";

  return (
    <div id="recommendation" style={{ ...s.card, ...(props.highlight ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px #bfdbfe" } : {}) }}>
      <h3 style={{ marginTop: 0 }}>
        Recommendation <Badge tone={STATUS_TONE[rec.status] ?? "plain"}>{STATUS_LABEL[rec.status] ?? rec.status}</Badge>
        <span style={s.muted}>comparative v{cmp?.version ?? "?"} · {rec.model ?? "template"} · {String(rec.created_at ?? "").slice(0, 16).replace("T", " ")}</span>
      </h3>
      {explanation.summary.length > 0 && <ul style={{ paddingLeft: 18 }}>{explanation.summary.map((x, i) => <Sentence key={i} sent={x} links={links} titles={titles} />)}</ul>}
      {!rec.top_vendor_id && <p><Badge tone="warn">Ranking withheld</Badge><span style={s.muted}>Fewer than three comparable quotes. No vendor is ranked.</span></p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
        {top3.map((r) => {
          const sc = scoreOf.get(r.vendor_id);
          return (
            <div key={r.vendor_id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, background: r.vendor_id === rec.top_vendor_id ? "#f0f9ff" : "#fff" }}>
              <div><strong>#{r.rank} {name(r.vendor_id)}</strong> <span style={s.muted}>total {fmtNum(sc?.total ?? r.total)}</span></div>
              <div>{(sc?.risk_flags ?? []).map((f, i) => <Badge key={i} tone={f.severity} title={f.message}>{f.code.replace(/_/g, " ")}</Badge>)}</div>
              <ul style={{ paddingLeft: 18, marginBottom: 0 }}>{(reasonsOf.get(r.vendor_id) ?? []).map((x, i) => <Sentence key={i} sent={x} links={links} titles={titles} />)}</ul>
            </div>
          );
        })}
      </div>
      <RecommendationClient
        recommendationId={rec.id}
        status={rec.status}
        topVendorId={rec.top_vendor_id ?? null}
        vendors={(cmp?.matrix.vendors ?? []).map((v) => ({ vendor_id: v.vendor_id, name: v.name }))}
        scores={scores}
        weights={cmp?.weights ?? null}
        canDecide={canDecide}
        decision={decision}
      />
    </div>
  );
}
