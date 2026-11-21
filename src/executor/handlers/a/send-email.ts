import { registerHandler } from "../..";
import { admin } from "../../../lib/supabase";
import { emit } from "../../../lib/steps";
import { sendDraft, sendMail, updateDraft } from "../../../channels/gmail/drafts";
import type { MailInput } from "../../../channels/gmail/mime";

/** Payload of a `send_email` action. The approved payload is what we send, including the engineer's edits. */
export interface SendEmailPayload extends MailInput {
  draft_id?: string;          // Gmail draft created when the agent drafted the mail
  thread_id?: string;         // reply in an existing thread
  rfq_recipient_id?: string;  // set for RFQs: records the thread and the send time
}

registerHandler("send_email", async (action) => {
  const p = action.payload as unknown as SendEmailPayload;
  // Record identifiers come from the payload the agent proposed, never from the approver's edits.
  // An edit may change the text and the recipients. It may not point the send at another record.
  const ids = (action.original_payload ?? {}) as Partial<SendEmailPayload>;
  const draftId = ids.draft_id, threadId = ids.thread_id, rfqRecipientId = ids.rfq_recipient_id;
  const userId = action.approved_by;
  if (!userId) throw new Error("send_email needs an approver: its mail leaves from the approver's mailbox.");
  const mail: MailInput = { to: p.to, cc: p.cc, subject: p.subject, body: p.body, inReplyTo: p.inReplyTo };

  let sent: { messageId: string; threadId: string };
  const db = admin();
  if (rfqRecipientId) {
    // The recipient row must belong to the case of this action. Check before anything leaves the mailbox.
    const { data: rr } = await db.from("rfq_recipients").select("id, rfqs!inner(case_id)").eq("id", rfqRecipientId).single();
    const owner = (rr as any)?.rfqs?.case_id;
    if (!action.case_id || owner !== action.case_id) throw new Error("rfq_recipient_id does not belong to the case of this action.");
  }

  if (draftId) { await updateDraft(userId, draftId, mail, threadId); sent = await sendDraft(userId, draftId); }
  else sent = await sendMail(userId, mail, threadId);

  await db.from("messages").insert({
    case_id: action.case_id, channel: "email", direction: "out", external_id: sent.messageId, thread_id: sent.threadId,
    recipients: [...p.to, ...(p.cc ?? [])], subject: p.subject, body: p.body,
  });
  if (rfqRecipientId) {
    const sentAt = new Date().toISOString();
    const { data: rr } = await db.from("rfq_recipients")
      .update({ gmail_thread_id: sent.threadId, sent_at: sentAt, status: "sent" }).eq("id", rfqRecipientId).select("rfq_id,vendor_id").single();
    if (rr) await emit("rfq.sent", { rfq_id: rr.rfq_id, vendor_id: rr.vendor_id, sent_at: sentAt }, { caseId: action.case_id ?? undefined });
  }
  return { provider_id: sent.messageId, result: { threadId: sent.threadId } };
});
