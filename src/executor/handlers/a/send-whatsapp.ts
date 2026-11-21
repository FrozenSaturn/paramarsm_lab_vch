import { registerHandler } from "../..";
import { admin } from "../../../lib/supabase";
import { sendMedia, sendText } from "../../../channels/whatsapp/bridge";
import { digits, findKnown } from "../../../channels/whatsapp/numbers";

/** Payload of a `send_whatsapp` action. */
export interface SendWhatsAppPayload { to: string; text: string; attachment_paths?: string[] }

const BUCKET = process.env.STORAGE_BUCKET || "documents";
const MAX_PER_HOUR = Number(process.env.WHATSAPP_MAX_PER_HOUR ?? 20);

/** Sends one WhatsApp message to a number on the allow-list. WhatsApp is for short messages to site and vendors.
 *  RFQs go by email. The unofficial WhatsApp Web link can get a number banned, so the volume stays low. */
registerHandler("send_whatsapp", async (action) => {
  const p = action.payload as unknown as SendWhatsAppPayload;
  // Attachments come from the payload the agent proposed, never from an approver's edit.
  const attachments = ((action.original_payload ?? {}) as Partial<SendWhatsAppPayload>).attachment_paths ?? [];
  const to = digits(p.to);
  if (!to || typeof p.text !== "string" || !p.text.trim()) throw new Error("A WhatsApp message needs a number and a text.");
  if (!(await findKnown(to))) throw new Error("This number is not on the allow-list. Add it to a person or a vendor contact first.");

  const db = admin();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("channel", "whatsapp").eq("direction", "out").gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_HOUR) throw new Error(`WhatsApp limit reached: ${MAX_PER_HOUR} messages in the last hour.`);

  let id: string | null;
  if (process.env.MAIL_DRY_RUN === "true") id = `dry-${action.id.slice(0, 8)}`; // everything except the call to the bridge
  else if (attachments.length) {
    id = null;
    for (const [i, path] of attachments.entries()) {
      const f = await db.storage.from(BUCKET).download(path);
      if (f.error || !f.data) throw new Error(`could not read attachment ${path}: ${f.error?.message}`);
      const mimetype = f.data.type || "application/octet-stream";
      const r = await sendMedia(to, { mediatype: mimetype.startsWith("image/") ? "image" : "document", data: Buffer.from(await f.data.arrayBuffer()), mimetype, fileName: path.split("/").pop()!, caption: i === 0 ? p.text : undefined });
      id ??= r.id;
    }
  } else id = (await sendText(to, p.text)).id;

  await db.from("messages").insert({
    case_id: action.case_id, channel: "whatsapp", direction: "out", external_id: `wa:${id ?? action.id}`, thread_id: `${to}@s.whatsapp.net`,
    recipients: [to], body: p.text,
  });
  return { provider_id: id ?? undefined, result: { to, dryRun: process.env.MAIL_DRY_RUN === "true" } };
});
