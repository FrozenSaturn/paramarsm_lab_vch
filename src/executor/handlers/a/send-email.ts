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
  const userId = action.approved_by;
  if (!userId) throw new Error("send_email needs an approver: its mail leaves from the approver's mailbox.");
  const mail: MailInput = { to: p.to, cc: p.cc, subject: p.subject, body: p.body, inReplyTo: p.inReplyTo };

  let sent: { messageId: string; threadId: string };
  if (p.draft_id) { await updateDraft(userId, p.draft_id, mail, p.thread_id); sent = await sendDraft(userId, p.draft_id); }
  else sent = await sendMail(userId, mail, p.thread_id);

  const db = admin();
  await db.from("messages").insert({
    case_id: action.case_id, channel: "email", direction: "out", external_id: sent.messageId, thread_id: sent.threadId,
    recipients: [...p.to, ...(p.cc ?? [])], subject: p.subject, body: p.body,
  });
  if (p.rfq_recipient_id) {
    const sentAt = new Date().toISOString();
    const { data: rr } = await db.from("rfq_recipients")
      .update({ gmail_thread_id: sent.threadId, sent_at: sentAt, status: "sent" }).eq("id", p.rfq_recipient_id).select("rfq_id,vendor_id").single();
    if (rr) await emit("rfq.sent", { rfq_id: rr.rfq_id, vendor_id: rr.vendor_id, sent_at: sentAt }, { caseId: action.case_id ?? undefined });
  }
  return { provider_id: sent.messageId, result: { threadId: sent.threadId } };
});
