import { gmailFor } from "./client";
import { buildMime, toRaw, type MailInput } from "./mime";

/** A real Gmail draft: the engineer can also edit it in Gmail. */
export async function createDraft(userId: string, mail: MailInput, threadId?: string) {
  const gmail = await gmailFor(userId);
  const { data } = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: toRaw(buildMime(mail)), threadId } } });
  return { draftId: data.id!, messageId: data.message?.id ?? null };
}

export async function updateDraft(userId: string, draftId: string, mail: MailInput, threadId?: string) {
  const gmail = await gmailFor(userId);
  await gmail.users.drafts.update({ userId: "me", id: draftId, requestBody: { message: { raw: toRaw(buildMime(mail)), threadId } } });
}

export async function sendDraft(userId: string, draftId: string) {
  const gmail = await gmailFor(userId);
  const { data } = await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
  return { messageId: data.id!, threadId: data.threadId! };
}

export async function sendMail(userId: string, mail: MailInput, threadId?: string) {
  const gmail = await gmailFor(userId);
  const { data } = await gmail.users.messages.send({ userId: "me", requestBody: { raw: toRaw(buildMime(mail)), threadId } });
  return { messageId: data.id!, threadId: data.threadId! };
}

export async function deleteDraft(userId: string, draftId: string) {
  const gmail = await gmailFor(userId);
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}
