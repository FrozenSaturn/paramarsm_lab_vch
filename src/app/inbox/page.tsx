import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requirePageUser, requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { openCase, triageMessage } from "@/triage/triage";
import { runBoqCheck } from "@/boq/pipeline";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function runTriage(form: FormData) {
  "use server";
  await requireRole("contracts_engineer", "admin");
  await triageMessage(String(form.get("id")));
  revalidatePath("/inbox");
}
/** A person decides to open a case from this message. If a BOQ sheet is attached, it is read at once. */
async function openCaseFromMessage(form: FormData) {
  "use server";
  await requireRole("contracts_engineer", "admin");
  const db = admin();
  const id = String(form.get("id"));
  const { data: m } = await db.from("messages").select("id, subject, body, case_id, sender, sender_verified").eq("id", id).single();
  if (!m || m.case_id) return;
  // The project comes from a person record only when the sender is verified. Otherwise the case has no project.
  const { data: person } = m.sender && m.sender_verified ? await db.from("people").select("project_id").ilike("email", m.sender.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle() : { data: null };
  const caseId = await openCase(id, String(form.get("title") || m.subject || "New requirement"), person?.project_id ?? null);
  const { data: docs } = await db.from("documents").select("id, filename, mime").eq("message_id", id);
  const sheet = (docs ?? []).find(d => /spreadsheet|excel|\.xlsx$/i.test(`${d.mime} ${d.filename}`));
  if (sheet) await runBoqCheck({ caseId, documentId: sheet.id, requirementText: `${m.subject ?? ""}\n${m.body ?? ""}` });
  revalidatePath("/inbox");
}

export default async function Inbox() {
  await requirePageUser();
  const { data } = await admin().from("messages").select("id, channel, sender, subject, classification, case_id, sender_verified, created_at").eq("direction", "in").order("created_at", { ascending: false }).limit(50);
  return (
    <>
      <h1>Inbox</h1>
      {!(data ?? []).length && <p>No inbound messages yet.</p>}
      <ul>{(data ?? []).map(m => (
        <li key={m.id} style={{ margin: "6px 0" }}>
          [{m.channel}] {m.sender}{m.sender_verified ? "" : " (sender not verified)"}: <b>{m.subject}</b> — {m.classification ?? "not sorted yet"}
          {m.case_id ? <> — <Link href={`/cases/${m.case_id}`}>open case</Link></> : null}
          {!m.classification && <form action={runTriage} style={{ display: "inline" }}><input type="hidden" name="id" value={m.id} /> <button>Sort it</button></form>}
          {!m.case_id && (m.classification === "requirement" || !m.classification) && <form action={openCaseFromMessage} style={{ display: "inline" }}><input type="hidden" name="id" value={m.id} /> <button>Open case from this mail</button></form>}
        </li>))}</ul>
    </>
  );
}
