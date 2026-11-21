import { revalidatePath } from "next/cache";
import Link from "next/link";
import { admin } from "@/lib/supabase";
import { requirePageUser, requireRole } from "@/lib/auth";
import { mapBoqVersion } from "@/codes/pipeline";
import { proposeAction } from "@/executor";
import { ActionButtons } from "@/components/ActionButtons";
import { CodeChoice } from "./choice";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Flag = { type: string; [k: string]: any };

export default async function Codes({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const db = admin();
  const { data: ver } = await db.from("boq_versions").select("id, version, status").eq("case_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!ver) return <p>This case has no BOQ yet.</p>;
  const { data: lines } = await db.from("boq_lines").select("id, serial, description, unit, quantity, item_code, flags").eq("boq_version_id", ver.id).order("serial");

  async function run() {
    "use server";
    await requireRole("contracts_engineer", "hod", "admin"); // read-only roles can look but not start the mapping
    const { data: v } = await admin().from("boq_versions").select("id, status").eq("id", ver!.id).single();
    if (v?.status !== "accepted") throw new Error("Accept the BOQ first.");
    await mapBoqVersion(v.id);
    revalidatePath(`/cases/${id}/codes`);
  }

  const { data: props } = await db.from("code_proposals").select("id, proposed_code, description, status").eq("case_id", id);
  const { data: erpActs } = await db.from("actions").select("id, status, original_payload, error").eq("case_id", id).eq("kind", "erp_import_sheet").order("created_at", { ascending: false });
  const open = (props ?? []).filter(p => p.status === "proposed");
  const waiting = (erpActs ?? []).find(a => ["proposed", "edited"].includes(a.status));

  async function requestSheet() {
    "use server";
    await requireRole("contracts_engineer", "hod", "admin");
    const { data: ps } = await admin().from("code_proposals").select("id").eq("case_id", id).eq("status", "proposed");
    if (ps?.length) await proposeAction("erp_import_sheet", id, { proposal_ids: ps.map(p => p.id) }, { proposedBy: "user" });
    revalidatePath(`/cases/${id}/codes`);
  }

  return (
    <>
      <p><Link href={`/cases/${id}`}>Back to case</Link></p>
      <h1>Item codes for BOQ version {ver.version}</h1>
      {ver.status === "accepted"
        ? <form action={run}><button>Suggest codes</button> (first run loads the embedding model and takes about 15 seconds)</form>
        : <p>Accept the BOQ on the <Link href={`/cases/${id}/boq`}>BOQ page</Link> before codes are suggested.</p>}
      {(props ?? []).length > 0 && <div style={{ background: "#eff6ff", padding: 8, margin: "8px 0" }}>
        <b>New code requests</b>
        <ul>{(props ?? []).map(p => <li key={p.id}>{p.proposed_code}: {p.description} ({p.status})</li>)}</ul>
        {waiting ? <div>Import sheet waiting for approval. <ActionButtons actionId={waiting.id} approveLabel="Approve and build the sheet" /></div>
          : open.length > 0 ? <form action={requestSheet}><button>Build the ERP import sheet</button> A person uploads it to Farvision. We never write to Farvision.</form> : null}
        {(erpActs ?? []).filter(a => a.status === "executed").map(a => <div key={a.id}><a href={`/api/erp-sheets/${a.id}/download`}>Download import sheet</a></div>)}
      </div>}
      {(lines ?? []).map(l => {
        const flags = (l.flags ?? []) as Flag[];
        const s = flags.find(f => f.type === "code_suggestion");
        const done = flags.find(f => f.type === "code_confirmed" || f.type === "new_code_pending");
        return (
          <div key={l.id} style={{ borderTop: "1px solid #ddd", padding: "8px 0" }}>
            <b>{l.serial}.</b> {l.description} <i>({l.quantity ?? "not measured"} {l.unit})</i> site code: {flags.find(f => f.type === "site_code")?.value ?? "none"}
            {done && <div>{done.type === "code_confirmed" ? "Confirmed" : "New code requested"}: <b>{l.item_code}</b></div>}
            {!done && s && (
              <div>
                <div>{s.decision === "auto" ? "Suggested" : s.decision === "new" ? "No match, new code proposed" : "Needs a decision"} (confidence {s.confidence}, {s.judged_by}): {s.reason}</div>
                <ul>
                  {s.picks.slice(0, 3).map((p: any) => (
                    <li key={p.code + p.description}>{p.code} "{p.description}" score {p.score}
                      {p.sameMeaningCodes?.length ? ` (same wording also under ${p.sameMeaningCodes.join(", ")})` : ""}
                      {p.conflicts?.length ? ` conflict: ${p.conflicts.join("; ")}` : ""} <CodeChoice lineId={l.id} itemCodeId={p.ids[0]} label={`Use ${p.code}`} />
                    </li>))}
                </ul>
                {s.proposed_new && <div>Proposed new code {s.proposed_new.code}: "{s.proposed_new.description}" <CodeChoice lineId={l.id} newCode label={`Request ${s.proposed_new.code}`} /></div>}
              </div>)}
          </div>);
      })}
    </>
  );
}
