import { admin } from "../lib/supabase";
import { logStep } from "../lib/steps";
import { proposeAction } from "../executor";
import { createDraft } from "../channels/gmail/drafts";
import { RFQ_TERMS } from "../lib/rfq-terms";
import { categoryOfCodes, shortlistVendors } from "./shortlist";
import { findSimilarTenders } from "./similar";
import { buildBlankRateSheet, buildRfqMail } from "./pack";

const BUCKET = process.env.STORAGE_BUCKET || "documents";
const addDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

export interface PrepareResult {
  rfqId: string; ref: string; dueDate: string; existing: boolean; packPath: string | null;
  invited: { vendor: string; email: string; actionId: string; gmailDraft: boolean }[];
  skipped: { vendor: string; why: string }[]; similar: Awaited<ReturnType<typeof findSimilarTenders>>; warnings: string[];
}

/** W3: check for a similar tender, shortlist vendors, build the tender pack and draft one RFQ mail per vendor.
 *  Nothing is sent. Each mail waits as a proposed action for the engineer to edit and approve. */
export async function prepareTender(opts: { caseId: string; userId?: string; dueDate?: string; gmailDrafts?: boolean }): Promise<PrepareResult> {
  const db = admin();
  const { data: cs } = await db.from("cases").select("id, title").eq("id", opts.caseId).single();
  if (!cs) throw new Error("case not found");

  const { data: open } = await db.from("rfqs").select("id, ref, due_date").eq("case_id", cs.id).in("status", ["draft", "sent"]).limit(1).maybeSingle();
  if (open) return { rfqId: open.id, ref: open.ref!, dueDate: open.due_date ?? "", existing: true, packPath: null, invited: [], skipped: [], similar: [], warnings: [`This case already has ${open.ref}.`] };

  const { data: ver } = await db.from("boq_versions").select("id, status").eq("case_id", cs.id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!ver || ver.status !== "accepted") throw new Error("Accept the BOQ before you prepare the tender.");
  const { data: lines } = await db.from("boq_lines").select("serial, description, unit, quantity, item_code, flags").eq("boq_version_id", ver.id).order("serial");
  const missing = (lines ?? []).filter(l => !l.item_code);
  if (missing.length) throw new Error(`Confirm an item code for every line first. Missing: ${missing.map(l => l.serial).join(", ")}.`);

  const warnings: string[] = [];
  const category = categoryOfCodes((lines ?? []).map(l => l.item_code));
  if (!category) throw new Error("Could not tell the work category from the item codes.");
  const [{ vendors, warnings: sw }, similar] = await Promise.all([shortlistVendors(category), findSimilarTenders(cs.id)]);
  warnings.push(...sw);
  if (similar.length) warnings.push(`Looks like ${similar[0].rfqRef} (${similar[0].caseTitle}): ${similar[0].reasons.join("; ")}.`);
  const invitees = vendors.filter(v => v.email);
  if (!invitees.length) throw new Error("No vendor with a contact email. Nothing to send.");

  // Next reference: RFQ-0032 after RFQ-0031. Ignores refs of other shapes.
  const { data: refs } = await db.from("rfqs").select("ref");
  const next = Math.max(0, ...(refs ?? []).map(r => Number(/^RFQ-(\d+)$/.exec(r.ref ?? "")?.[1] ?? 0))) + 1;
  const ref = `RFQ-${String(next).padStart(4, "0")}`;
  const dueDate = opts.dueDate ?? addDays(7);

  const sheet = await buildBlankRateSheet({ title: cs.title, ref, dueDate }, (lines ?? []).map(l => ({ serial: l.serial, code: l.item_code, description: l.description, unit: l.unit, quantity: l.quantity == null ? null : Number(l.quantity) })));
  const packPath = `tender/${cs.id}/${ref}_BOQ_rates_blank.xlsx`;
  const up = await db.storage.from(BUCKET).upload(packPath, sheet, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true });
  if (up.error) throw new Error(`could not store the tender pack: ${up.error.message}`);
  await db.from("documents").insert({ case_id: cs.id, filename: `${ref}_BOQ_rates_blank.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", storage_path: packPath, kind: "tender_pack" });

  const { data: rfq, error } = await db.from("rfqs").insert({ case_id: cs.id, ref, due_date: dueDate, terms: RFQ_TERMS as any, status: "draft" }).select("id").single();
  if (error) throw error;

  // Real Gmail drafts, so the engineer can also edit them in Gmail. Needs the mailbox owner's token.
  let mailbox = opts.userId;
  if (!mailbox) mailbox = (await db.from("profiles").select("id").eq("role", "contracts_engineer").limit(1).maybeSingle()).data?.id;
  const useGmail = (opts.gmailDrafts ?? process.env.MAIL_DRY_RUN !== "true") && !!mailbox;
  const cc = (process.env.RFQ_CC ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const sender = process.env.RFQ_SENDER || "Contracts & Planning, Vinayak Group";
  const mail = buildRfqMail({ title: cs.title, ref, dueDate, sender });

  const invited: PrepareResult["invited"] = [];
  for (const v of invitees) {
    const { data: rr } = await db.from("rfq_recipients").insert({ rfq_id: rfq.id, vendor_id: v.vendorId, email: v.email, status: "draft" }).select("id").single();
    let draftId: string | undefined;
    if (useGmail) {
      try { draftId = (await createDraft(mailbox!, { to: [v.email!], cc, ...mail, attachments: [{ filename: `${ref}_BOQ_rates_blank.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: sheet }] })).draftId; }
      catch (e: any) { warnings.push(`Gmail draft for ${v.name} failed (${String(e?.message ?? e).slice(0, 80)}). The mail will still send from the app.`); }
    }
    if (draftId) await db.from("rfq_recipients").update({ gmail_draft_id: draftId }).eq("id", rr!.id);
    const a = await proposeAction("send_email", cs.id, { to: [v.email], cc, ...mail, draft_id: draftId, rfq_recipient_id: rr!.id, attachment_paths: [packPath] }, { proposedBy: "W3" });
    invited.push({ vendor: v.name, email: v.email!, actionId: a.id, gmailDraft: !!draftId });
  }
  await db.from("cases").update({ stage: "tender" }).eq("id", cs.id);
  const skipped = vendors.filter(v => !v.email).map(v => ({ vendor: v.name, why: "no contact email" }));
  await logStep({ caseId: cs.id, workflow: "W3", step: "prepare tender",
    input: { category, due: dueDate }, output: { ref, invited: invited.length, skipped: skipped.length, similar: similar.map(s => s.rfqRef), warnings },
    reasoning: `Shortlisted ${vendors.length} ${category} vendor(s); ${invited.length} RFQ draft(s) wait for approval.` });
  return { rfqId: rfq.id, ref, dueDate, existing: false, packPath, invited, skipped, similar, warnings };
}
