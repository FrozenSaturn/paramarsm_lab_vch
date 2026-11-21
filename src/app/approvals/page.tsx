import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { RecommendationPanel } from "@/components/case/b/RecommendationPanel";
import { ActionButtons } from "@/components/case/b/ActionButtons";
import { Badge, s } from "@/components/case/b/ui";
export const dynamic = "force-dynamic";

type Act = { id: string; case_id: string | null; kind: string; status: string; payload: Record<string, any>; proposed_by: string | null; created_at: string | null };

const KIND_LABEL: Record<string, string> = {
  notify_hod: "Send packet to the HOD", send_email: "Emails", performance_record: "Vendor performance ratings",
};

const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

/** One renderer for each action kind. */
function ActionBody({ a, vendorNames }: { a: Act; vendorNames: Record<string, string> }) {
  const p = a.payload ?? {};
  if (a.kind === "notify_hod") {
    return (
      <div>
        <div>{p.summary}</div>
        <div style={s.muted}>
          Top vendor: {vendorNames[p.top_vendor_id] ?? p.top_vendor_id ?? "—"} ·{" "}
          {p.recommendation_id && <Link href={`/approvals?rec=${p.recommendation_id}#recommendation`}>View recommendation</Link>}
          {a.case_id && <> · <Link href={`/dev/quotes?case=${a.case_id}`}>Comparative</Link></>}
        </div>
      </div>
    );
  }
  if (a.kind === "send_email") {
    const body = str(p.body ?? p.text ?? p.html);
    return (
      <div>
        <div><strong>To:</strong> {str(p.to)}{p.cc ? <> · <strong>Cc:</strong> {str(p.cc)}</> : null}</div>
        <div><strong>Subject:</strong> {str(p.subject)}</div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", background: "#f8fafc", padding: 8, borderRadius: 6, maxHeight: 200, overflow: "auto", margin: "4px 0" }}>{body.slice(0, 2000)}</pre>
      </div>
    );
  }
  if (a.kind === "performance_record") {
    const r = (k: string) => (p[k] == null ? "—" : `${p[k]}/5`);
    return (
      <div>
        <div><strong>{p.vendor_name ?? vendorNames[p.vendor_id] ?? p.vendor_id}</strong></div>
        <div>Quality {r("quality")} · Timeliness {r("timeliness")} · Disputes {r("disputes")} · Safety {r("safety")}</div>
        {p.note && <div>Note: {p.note}</div>}
        {p.evidence && <div style={s.muted}>Evidence: {p.evidence}</div>}
      </div>
    );
  }
  return <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 8, borderRadius: 6, maxHeight: 200, overflow: "auto" }}>{JSON.stringify(p, null, 2)}</pre>;
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ rec?: string }> }) {
  const user = await requirePageUser();
  const { rec: highlight } = await searchParams;
  const db = admin();

  const [{ data: recs }, { data: acts }, { data: cases }] = await Promise.all([
    db.from("recommendations").select("id,case_id,created_at").eq("status", "with_hod").order("created_at", { ascending: false }),
    db.from("actions").select("id,case_id,kind,status,payload,proposed_by,created_at").in("status", ["proposed", "edited"]).order("created_at", { ascending: false }).limit(200),
    db.from("cases").select("id,title"),
  ]);
  const caseTitle = new Map(((cases ?? []) as any[]).map((c) => [c.id as string, c.title as string]));
  const actions = (acts ?? []) as Act[];

  // Vendor names for the action renderers.
  const vendorIds = [...new Set(actions.flatMap((a) => [a.payload?.top_vendor_id, a.payload?.vendor_id]).filter((x): x is string => typeof x === "string"))];
  const { data: vrows } = vendorIds.length ? await db.from("vendors").select("id,name").in("id", vendorIds) : { data: [] };
  const vendorNames: Record<string, string> = Object.fromEntries(((vrows ?? []) as any[]).map((v) => [v.id, v.name]));

  // Group by kind, keep newest first inside each group.
  const groups = new Map<string, Act[]>();
  for (const a of actions) groups.set(a.kind, [...(groups.get(a.kind) ?? []), a]);

  // A highlighted recommendation that is not with the HOD still shows at the top.
  const recIds = ((recs ?? []) as any[]).map((r) => r.id as string);
  const extra = highlight && !recIds.includes(highlight) ? highlight : null;

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>Approvals</h1>
      <p style={s.muted}>Signed in as {user.email} · role <Badge tone="info">{user.role}</Badge>{user.realRole !== user.role && <span>(viewing as; stored role {user.realRole})</span>}</p>

      <h2>Recommendations waiting for the HOD</h2>
      {user.role !== "hod" && recIds.length > 0 && <p style={s.muted}>Only a HOD can record a decision. You can read the packets.</p>}
      {extra && <RecommendationPanel recommendationId={extra} highlight />}
      {recIds.length === 0 && !extra && <p style={s.muted}>No recommendation is waiting for the HOD.</p>}
      {((recs ?? []) as any[]).map((r) => (
        <div key={r.id}>
          <div style={s.muted}>{caseTitle.get(r.case_id) ?? "Case"}</div>
          <RecommendationPanel recommendationId={r.id} highlight={r.id === highlight} />
        </div>
      ))}

      <h2>Actions waiting for approval</h2>
      {actions.length === 0 && <p style={s.muted}>No action is waiting.</p>}
      {[...groups.entries()].map(([kind, list]) => (
        <section key={kind} style={{ marginBottom: 16 }}>
          <h3>{KIND_LABEL[kind] ?? kind} <Badge>{list.length}</Badge></h3>
          {list.map((a) => (
            <div key={a.id} style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={s.muted}>
                  {a.case_id ? caseTitle.get(a.case_id) ?? a.case_id.slice(0, 8) : "No case"} · {String(a.created_at ?? "").slice(0, 16).replace("T", " ")}
                  {a.proposed_by ? ` · by ${a.proposed_by}` : ""}
                  {a.status === "edited" && <> <Badge tone="warn">edited</Badge></>}
                </span>
                <ActionButtons actionId={a.id} />
              </div>
              <ActionBody a={a} vendorNames={vendorNames} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
