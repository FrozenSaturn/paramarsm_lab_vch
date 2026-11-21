import Link from "next/link";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/supabase";
import { requireRole, requirePageUser } from "@/lib/auth";
import { emit } from "@/lib/steps";
import { ClarificationEditor } from "./editor";
export const dynamic = "force-dynamic";

type Flag = { type: string; [k: string]: any };
const color = { error: "var(--danger)", warn: "var(--warn)", info: "var(--ink-subtle)" } as const;

export default async function BoqPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const db = admin();
  const { data: cs } = await db.from("cases").select("id, title, stage").eq("id", id).single();
  const { data: ver } = await db.from("boq_versions").select("id, version, status").eq("case_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!cs || !ver) return <p>This case has no BOQ yet. Upload one at <Link href="/dev/boq">/dev/boq</Link>.</p>;
  const [{ data: lines }, { data: checks }, { data: acts }] = await Promise.all([
    db.from("boq_lines").select("id, serial, description, unit, quantity, flags").eq("boq_version_id", ver.id).order("serial"),
    db.from("extracted_fields").select("value").eq("entity_type", "boq_version").eq("entity_id", ver.id),
    db.from("actions").select("id, status, payload, error").eq("case_id", id).eq("kind", "send_clarification").order("created_at", { ascending: false }).limit(1),
  ]);
  const act = acts?.[0];
  const findings = (checks ?? []).map(c => c.value as { severity: keyof typeof color; code: string; message: string });

  async function accept() {
    "use server";
    const user = await requireRole("contracts_engineer", "admin");
    await admin().from("boq_versions").update({ status: "accepted" }).eq("id", ver!.id);
    await admin().from("cases").update({ stage: "codes" }).eq("id", id);
    await emit("boq.accepted", { case_id: id, boq_version_id: ver!.id }, { caseId: id, actor: user.id });
    revalidatePath(`/cases/${id}/boq`);
  }

  return (
    <>
      <p><Link href={`/cases/${id}`}>Back to case</Link> | <Link href={`/cases/${id}/codes`}>Item codes</Link></p>
      <h1>{cs.title}: BOQ version {ver.version} ({ver.status})</h1>

      <h2>Checks ({findings.length})</h2>
      {findings.length === 0 ? <p>No findings.</p> : <ul>{findings.map((f, i) => <li key={i} style={{ color: color[f.severity] }}>[{f.severity}] {f.message}</li>)}</ul>}

      <h2>Lines</h2>
      <table>
        <thead><tr><th align="left">#</th><th align="left">Site code</th><th align="left">Description</th><th align="right">Quantity</th><th align="left">Unit</th><th align="left">Flags</th></tr></thead>
        <tbody>{(lines ?? []).map(l => {
          const fl = (l.flags ?? []) as Flag[];
          return <tr key={l.id}>
            <td>{l.serial}</td><td>{fl.find(f => f.type === "site_code")?.value ?? ""}</td><td>{l.description}</td>
            <td align="right">{l.quantity == null ? "—" : Math.round(Number(l.quantity) * 100) / 100}</td><td>{l.unit}</td>
            <td>{fl.filter(f => f.type === "not_measured" || f.type === "check").map(f => f.type === "not_measured" ? "not measured" : f.code).join(", ")}</td></tr>;
        })}</tbody>
      </table>

      <h2>Clarification to site</h2>
      {!act ? <p>No clarification is needed.</p>
        : act.status === "executed" ? <p>Sent to {(act.payload as any).to?.join(", ")}.</p>
        : act.status === "rejected" ? <p>Not sent.</p>
        : <>{act.error && <p style={{ color: color.error }}>Last error: {act.error}</p>}
            <ClarificationEditor actionId={act.id} to={(act.payload as any).to ?? []} subject={(act.payload as any).subject} body={(act.payload as any).body} /></>}

      <h2>Accept this BOQ</h2>
      {ver.status === "accepted" ? <p>Accepted. Item-code suggestions start from this version.</p>
        : <form action={accept}><button>Accept BOQ and suggest item codes</button></form>}
    </>
  );
}
