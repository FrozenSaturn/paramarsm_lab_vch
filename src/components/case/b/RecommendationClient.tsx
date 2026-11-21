"use client";
/**
 * Browser part of the recommendation panel: "what if" weights and the HOD decision form.
 * "What if" runs rerank() in the browser. It changes nothing in the database.
 * The decision goes to the server action decideFromForm, which checks the HOD role.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideFromForm } from "@/compare/decide";
import { rerank } from "@/scoring/whatif";
import { DEFAULT_WEIGHTS, PARAMS, PARAM_LABELS, type VendorScore, type Weights } from "@/scoring/types";
import { Badge, s } from "./ui";

export interface DecisionView {
  kind: string;
  vendorName: string | null;
  reason: string | null;
  at: string | null;
  by: string;
}

const MIN_REASON = 5;
const KIND_LABEL: Record<string, string> = { approve: "Approved top vendor", override: "Chose another vendor", send_back: "Sent back" };

export function RecommendationClient(props: {
  recommendationId: string;
  status: string;
  topVendorId: string | null;
  vendors: { vendor_id: string; name: string }[];
  scores: VendorScore[];
  weights: Weights | null;
  canDecide: boolean;
  decision: DecisionView | null;
}) {
  const start = props.weights ?? DEFAULT_WEIGHTS;
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(PARAMS.map((p) => [p, String(start[p])])));
  const nums = Object.fromEntries(PARAMS.map((p) => [p, Number(w[p])])) as Weights;
  const sum = PARAMS.reduce((a, p) => a + (Number.isFinite(nums[p]) ? nums[p] : 0), 0);
  const valid = PARAMS.every((p) => w[p] !== "" && Number.isFinite(nums[p]) && nums[p] >= 0) && Math.abs(sum - 100) < 1e-6;
  const name = (id: string) => props.vendors.find((v) => v.vendor_id === id)?.name ?? id.slice(0, 8);

  // New order with the on-screen weights; null when the weights are not valid.
  const reranked = useMemo(() => {
    if (!valid || !props.scores.length) return null;
    try { return rerank(props.scores, nums).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.total - a.total); }
    catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, JSON.stringify(w), props.scores]);

  const changed = PARAMS.some((p) => nums[p] !== start[p]);

  return (
    <div style={{ marginTop: 12 }}>
      {props.scores.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>What if (change the weights)</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0", alignItems: "end" }}>
            {PARAMS.map((p) => (
              <label key={p} style={{ fontSize: 12 }}>{PARAM_LABELS[p]}<br />
                <input type="number" min={0} max={100} step="any" value={w[p]} onChange={(e) => setW({ ...w, [p]: e.target.value })} style={{ width: 70 }} />
              </label>
            ))}
            <span>Sum: <strong style={{ color: valid ? "#166534" : "#991b1b" }}>{Math.round(sum * 100) / 100}</strong>{!valid && <span style={s.muted}> (must be 100)</span>}</span>
            <button type="button" style={s.button} onClick={() => setW(Object.fromEntries(PARAMS.map((p) => [p, String(start[p])])))}>Reset</button>
          </div>
          {reranked && (
            <table style={{ ...s.table, maxWidth: 480 }}>
              <thead><tr><th style={s.th}>Rank</th><th style={s.th}>Vendor</th><th style={{ ...s.th, ...s.num }}>Total</th></tr></thead>
              <tbody>
                {reranked.map((x) => (
                  <tr key={x.vendor_id}>
                    <td style={s.td}>{x.rank ?? "—"}</td>
                    <td style={s.td}>{name(x.vendor_id)}{x.vendor_id === props.topVendorId && <Badge tone="info">stored top</Badge>}</td>
                    <td style={{ ...s.td, ...s.num }}>{x.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={s.muted}>This view does not change the stored ranking.</p>
        </details>
      )}

      {props.decision && (
        <div style={{ marginTop: 8, padding: 8, background: "#f8fafc", borderRadius: 6 }}>
          <strong>{KIND_LABEL[props.decision.kind] ?? props.decision.kind}</strong>
          {props.decision.vendorName && <> : {props.decision.vendorName}</>}
          <div style={s.muted}>by {props.decision.by}{props.decision.at ? ` on ${props.decision.at.slice(0, 16).replace("T", " ")}` : ""}</div>
          {props.decision.reason && <div>Reason: {props.decision.reason}</div>}
        </div>
      )}

      {props.canDecide && !props.decision && (
        <DecisionForm {...props} name={name} weights={valid && changed ? nums : null} />
      )}
    </div>
  );
}

function DecisionForm(props: {
  recommendationId: string;
  topVendorId: string | null;
  vendors: { vendor_id: string; name: string }[];
  name: (id: string) => string;
  weights: Weights | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [other, setOther] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [backReason, setBackReason] = useState("");
  const others = props.vendors.filter((v) => v.vendor_id !== props.topVendorId);

  const submit = (kind: "approve" | "override" | "send_back", vendorId: string | null, reason: string | null) => {
    const f = new FormData();
    f.set("recommendation_id", props.recommendationId);
    f.set("kind", kind);
    if (vendorId) f.set("vendor_id", vendorId);
    if (reason) f.set("reason", reason);
    if (props.weights) f.set("weights", JSON.stringify(props.weights));
    setMsg(null);
    startTransition(async () => {
      const res = await decideFromForm(f);
      if (res.ok) { setMsg({ ok: true, text: "Decision saved." }); router.refresh(); }
      else setMsg({ ok: false, text: res.error });
    });
  };

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 8 }}>
      <h4 style={{ margin: "4px 0 8px" }}>HOD decision</h4>
      {props.weights && <p style={s.muted}>Your "what if" weights are saved with the decision for the record.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <div>
          <button type="button" style={s.primary} disabled={pending || !props.topVendorId} onClick={() => submit("approve", props.topVendorId, null)}>
            Approve {props.topVendorId ? props.name(props.topVendorId) : "top vendor"}
          </button>
        </div>
        <div>
          <select value={other} onChange={(e) => setOther(e.target.value)} style={{ width: "100%" }}>
            <option value="">Pick another vendor…</option>
            {others.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
          </select>
          <textarea placeholder="Reason (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} style={{ width: "100%", marginTop: 4 }} />
          <button type="button" style={s.button} disabled={pending || !other || overrideReason.trim().length < MIN_REASON} onClick={() => submit("override", other, overrideReason.trim())}>
            Choose this vendor
          </button>
        </div>
        <div>
          <textarea placeholder="Reason to send back (required)" value={backReason} onChange={(e) => setBackReason(e.target.value)} rows={2} style={{ width: "100%" }} />
          <button type="button" style={s.button} disabled={pending || backReason.trim().length < MIN_REASON} onClick={() => submit("send_back", null, backReason.trim())}>
            Send back
          </button>
        </div>
      </div>
      {pending && <p style={s.muted}>Saving…</p>}
      {msg && <p style={{ color: msg.ok ? "#166534" : "#991b1b" }}>{msg.text}</p>}
    </div>
  );
}
