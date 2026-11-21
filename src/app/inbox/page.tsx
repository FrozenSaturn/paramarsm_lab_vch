import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requirePageUser, requireRole } from "@/lib/auth";
import { admin } from "@/lib/supabase";
import { openCase, triageMessage } from "@/triage/triage";
import { runBoqCheck } from "@/boq/pipeline";
import { PageHead, Pill, Empty, label, ago } from "@/components/ui";
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
  const { data: m } = await db.from("messages").select("id, subject, body, case_id, sender").eq("id", id).single();
  if (!m || m.case_id) return;
  const { data: person } = m.sender ? await db.from("people").select("project_id").ilike("email", m.sender.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle() : { data: null };
  const caseId = await openCase(id, String(form.get("title") || m.subject || "New requirement"), person?.project_id ?? null);
  const { data: docs } = await db.from("documents").select("id, filename, mime").eq("message_id", id);
  const sheet = (docs ?? []).find(d => /spreadsheet|excel|\.xlsx$/i.test(`${d.mime} ${d.filename}`));
  if (sheet) await runBoqCheck({ caseId, documentId: sheet.id, requirementText: `${m.subject ?? ""}\n${m.body ?? ""}` });
  revalidatePath("/inbox");
}

const CHANNEL: Record<string, string> = { email: "Email", gmail: "Email", whatsapp: "WhatsApp" };

export default async function Inbox() {
  await requirePageUser();
  const { data } = await admin().from("messages").select("id, channel, sender, subject, classification, case_id, sender_verified, created_at").eq("direction", "in").order("created_at", { ascending: false }).limit(50);
  const rows = data ?? [];
  return (
    <>
      <PageHead title="Inbox" sub="Every message that reached the Vinayak mailbox or WhatsApp number, with the class the triage agent gave it." />
      <div className="list">
        {rows.length === 0 && <Empty>No inbound messages yet.</Empty>}
        {rows.map(m => (
          <div key={m.id} className="list-row">
            <div style={{ minWidth: 0 }}>
              <div className="title">{m.subject || "(no subject)"}</div>
              <div className="sub">{m.sender}{m.sender_verified ? "" : " · sender not verified"} · {ago(m.created_at)}</div>
            </div>
            <div className="row">
              <Pill>{CHANNEL[m.channel] ?? m.channel}</Pill>
              <Pill tone={m.classification ? "info" : "plain"}>{m.classification ? label(m.classification) : "not sorted yet"}</Pill>
              {!m.sender_verified && <Pill tone="warn">unverified</Pill>}
              {m.case_id && <Link href={`/cases/${m.case_id}`} className="btn btn-ghost">Open case →</Link>}
              {!m.classification && <form action={runTriage}><input type="hidden" name="id" value={m.id} /><button>Sort it</button></form>}
              {!m.case_id && (m.classification === "requirement" || !m.classification) && <form action={openCaseFromMessage}><input type="hidden" name="id" value={m.id} /><button className="btn-primary">Open case from this mail</button></form>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
