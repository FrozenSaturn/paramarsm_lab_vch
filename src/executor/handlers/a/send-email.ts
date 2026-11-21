import { registerHandler } from "../..";
import { admin } from "../../../lib/supabase";
import { emit } from "../../../lib/steps";
import { sendDraft, sendMail, updateDraft } from "../../../channels/gmail/drafts";
import type { MailInput } from "../../../channels/gmail/mime";
import type { Handler } from "../../../contracts/actions";

/** Payload of a `send_email`, `send_clarification` or `send_reminder` action. The approved payload is what we send,
 *  including the engineer's edits to the text and the recipients. */
export interface SendEmailPayload extends MailInput {
  draft_id?: string;            // Gmail draft created when the agent drafted the mail
  thread_id?: string;           // reply in an existing thread
  rfq_recipient_id?: string;    // set for RFQs and reminders
  attachment_paths?: string[];  // Storage paths of files to attach
}

const BUCKET = process.env.STORAGE_BUCKET || "documents";

const sendEmail: Handler = async (action) => {
  const p = action.payload as unknown as SendEmailPayload;
  // Record ids and attachments come from the payload the agent proposed, never from the approver's edits.
  // An edit may change the text and the recipients. It may not point the send at another record or attach other files.
  const ids = (action.original_payload ?? {}) as Partial<SendEmailPayload>;
  const draftId = ids.draft_id, threadId = ids.thread_id, rfqRecipientId = ids.rfq_recipient_id;
  const userId = action.approved_by;
  if (!userId) throw new Error("The mail needs an approver: it leaves from the approver's mailbox.");
  const db = admin();

  if (rfqRecipientId) {
    // The recipient row must belong to the case of this action. Check before anything leaves the mailbox.
    const { data: rr } = await db.from("rfq_recipients").select("id, rfqs!inner(case_id)").eq("id", rfqRecipientId).single();
    const owner = (rr as any)?.rfqs?.case_id;
    if (!action.case_id || owner !== action.case_id) throw new Error("rfq_recipient_id does not belong to the case of this action.");
  }

  const attachments: NonNullable<MailInput["attachments"]> = [];
  for (const path of ids.attachment_paths ?? []) {
    const f = await db.storage.from(BUCKET).download(path);
    if (f.error || !f.data) throw new Error(`could not read attachment ${path}: ${f.error?.message}`);
    attachments.push({ filename: path.split("/").pop()!, mime: f.data.type || "application/octet-stream", data: Buffer.from(await f.data.arrayBuffer()) });
  }
  const mail: MailInput = { to: p.to, cc: p.cc, subject: p.subject, body: p.body, inReplyTo: p.inReplyTo, attachments };

  let sent: { messageId: string; threadId: string };
  if (process.env.MAIL_DRY_RUN === "true") {
    // Tests and demos: do everything except call Gmail.
    sent = { messageId: `dry-${action.id.slice(0, 8)}`, threadId: threadId ?? `dry-thread-${(rfqRecipientId ?? action.id).slice(0, 8)}` };
  } else if (draftId) { await updateDraft(userId, draftId, mail, threadId); sent = await sendDraft(userId, draftId); }
  else sent = await sendMail(userId, mail, threadId);

  await db.from("messages").insert({
    case_id: action.case_id, channel: "email", direction: "out", external_id: sent.messageId, thread_id: sent.threadId,
    recipients: [...p.to, ...(p.cc ?? [])], subject: p.subject, body: p.body,
  });
  if (rfqRecipientId) {
    const sentAt = new Date().toISOString();
    if (action.kind === "send_reminder") {
      const { data: cur } = await db.from("rfq_recipients").select("reminders_sent").eq("id", rfqRecipientId).single();
      await db.from("rfq_recipients").update({ reminders_sent: (cur?.reminders_sent ?? 0) + 1 }).eq("id", rfqRecipientId);
    } else {
      const { data: rr } = await db.from("rfq_recipients")
        .update({ gmail_thread_id: sent.threadId, sent_at: sentAt, status: "sent" }).eq("id", rfqRecipientId).select("rfq_id,vendor_id").single();
      if (rr) await emit("rfq.sent", { rfq_id: rr.rfq_id, vendor_id: rr.vendor_id, sent_at: sentAt }, { caseId: action.case_id ?? undefined });
    }
  }
  return { provider_id: sent.messageId, result: { threadId: sent.threadId, dryRun: process.env.MAIL_DRY_RUN === "true" } };
};
// A clarification to site and a reminder to a vendor are emails too. All kinds go through the same code.
registerHandler("send_email", sendEmail);
registerHandler("send_clarification", sendEmail);
registerHandler("send_reminder", sendEmail);
