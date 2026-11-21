import { admin } from "../lib/supabase";
import { logStep } from "../lib/steps";
import { runBoqCheck } from "../boq/pipeline";
import { classifyMessage, TRIAGE_PROMPT_VERSION } from "./classify";

const AUTO_CASE_CONFIDENCE = 0.8;
const XLSX = /spreadsheet|excel|\.xlsx$/i;

export interface TriageResult { category: string; confidence: number; caseId: string | null; action: "labelled" | "linked" | "case_opened" | "needs_person"; why: string }

/** W0: label an inbound message. Open a case on our own only when the sender is verified and is a person we know.
 *  Anything else is labelled and left for a person, who can open the case from the Inbox. */
export async function triageMessage(messageId: string): Promise<TriageResult> {
  const db = admin();
  const { data: m } = await db.from("messages").select("id, case_id, direction, sender, subject, body, thread_id, sender_verified, classification").eq("id", messageId).single();
  if (!m) throw new Error("message not found");
  if (m.direction !== "in") return { category: "outbound", confidence: 1, caseId: m.case_id, action: "labelled", why: "Outbound mail is not triaged." };
  const { data: docs } = await db.from("documents").select("id, filename, mime, storage_path").eq("message_id", m.id);

  const a = await classifyMessage({ sender: m.sender, subject: m.subject, body: m.body ?? "", attachments: (docs ?? []).map(d => ({ filename: d.filename ?? "", mime: d.mime ?? "" })) });
  let caseId: string | null = m.case_id, action: TriageResult["action"] = "labelled", why = a.reason;

  // A reply in a thread we already know joins that case, but only from a verified sender.
  // The sender must also be a participant: a person on that case's project, or an address that already wrote in this thread.
  if (!caseId && m.thread_id && m.sender_verified && m.sender) {
    const { data: t } = await db.from("messages").select("case_id, sender").eq("thread_id", m.thread_id).not("case_id", "is", null).neq("id", m.id);
    const known = await knownParticipant(m.sender, (t ?? []).map(x => ({ caseId: x.case_id as string, sender: x.sender as string | null })));
    if (known) { caseId = known; action = "linked"; why = `Same thread as an existing case, from a known participant. ${a.reason}`; }
    else if (t?.length) { action = "needs_person"; why = `The thread belongs to a case, but the sender is not a known participant. A person decides. ${a.reason}`; }
  }
  if (!caseId && a.category === "requirement") {
    const { data: person } = m.sender ? await db.from("people").select("id, project_id").ilike("email", m.sender.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle() : { data: null };
    if (m.sender_verified && person && a.confidence >= AUTO_CASE_CONFIDENCE) {
      caseId = await openCase(m.id, a.case_title || m.subject || "New requirement", person.project_id ?? null);
      action = "case_opened"; why = `Verified mail from a known person asks for work. ${a.reason}`;
    } else {
      action = "needs_person";
      why = `Looks like a requirement (${a.confidence.toFixed(2)}), but ${!m.sender_verified ? "the sender is not verified" : !person ? "the sender is not a known person" : "the confidence is low"}. A person decides. ${a.reason}`;
    }
  }
  // A label set by a rule (vendor_reply, unverified_reply) stays: it can mark mail for human review. The model label is in the step record.
  const ruleLabel = m.classification === "vendor_reply" || m.classification === "unverified_reply";
  await db.from("messages").update({ ...(ruleLabel ? {} : { classification: a.category }), ...(caseId ? { case_id: caseId } : {}) }).eq("id", m.id);
  if (caseId) await db.from("documents").update({ case_id: caseId }).eq("message_id", m.id).is("case_id", null);

  // A BOQ sheet on a case we opened ourselves is read at once. A sheet that arrives on an existing case waits for a person.
  if (caseId && a.category === "requirement" && action === "case_opened") {
    const sheet = (docs ?? []).find(d => XLSX.test(d.mime ?? "") || XLSX.test(d.filename ?? ""));
    if (sheet) { try { await runBoqCheck({ caseId, documentId: sheet.id, requirementText: `${m.subject ?? ""}\n${m.body ?? ""}` }); } catch (e: any) { why += ` The BOQ sheet could not be read: ${String(e?.message ?? e).slice(0, 100)}.`; } }
  }
  await logStep({ caseId: caseId ?? undefined, workflow: "W0", step: "triage", input: { message: m.id, subject: m.subject },
    output: { category: a.category, confidence: a.confidence, action, usage: { model: a.model, input_tokens: a.input_tokens, output_tokens: a.output_tokens } }, model: a.model, prompt_version: TRIAGE_PROMPT_VERSION, reasoning: why });
  return { category: a.category, confidence: a.confidence, caseId, action, why };
}

async function knownParticipant(sender: string, thread: { caseId: string; sender: string | null }[]): Promise<string | null> {
  const db = admin();
  const me = sender.toLowerCase();
  const wrote = thread.find(t => t.sender?.toLowerCase() === me);
  if (wrote) return wrote.caseId;
  const { data: person } = await db.from("people").select("project_id").ilike("email", me.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
  if (!person?.project_id) return null;
  for (const t of thread) {
    const { data: c } = await db.from("cases").select("project_id").eq("id", t.caseId).single();
    if (c?.project_id === person.project_id) return t.caseId;
  }
  return null;
}

/** Open a case from a message: a person's click in the Inbox, or W0 for a verified known sender. */
export async function openCase(messageId: string, title: string, projectId: string | null): Promise<string> {
  const db = admin();
  const { data: cs, error } = await db.from("cases").insert({ title: title.slice(0, 160), project_id: projectId, stage: "requirement", status: "open" }).select("id").single();
  if (error) throw error;
  await db.from("messages").update({ case_id: cs.id }).eq("id", messageId);
  await db.from("documents").update({ case_id: cs.id }).eq("message_id", messageId).is("case_id", null);
  return cs.id;
}
