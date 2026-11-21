import { createHash } from "node:crypto";
import { admin } from "../../lib/supabase";
import { emit } from "../../lib/steps";
import { downloadMedia } from "./bridge";
import { digits, findKnown, sameNumber } from "./numbers";

/** The message shape of the bridge (services/whatsapp/src/normalize.ts). Only the fields we use. */
export interface WaMessage {
  id: string; instance: string; chatJid: string; chatType: string; fromMe: boolean;
  sender: { jid: string | null; number: string | null; name: string | null };
  timestamp: string; kind: string; text: string | null; quotedId: string | null;
  media: { mimetype: string | null; fileName: string | null; bytes: number | null } | null;
}

const BUCKET = process.env.STORAGE_BUCKET || "documents";
const QUOTE_TYPES = /pdf|spreadsheet|excel|csv|image\//i;
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);

export type IngestResult = { stored: boolean; reason?: string; messageId?: string };

/** Store one WhatsApp message. Only allow-listed numbers are stored. Personal chats stay out of the database. */
export async function ingestWhatsApp(m: WaMessage): Promise<IngestResult> {
  if (m.fromMe) return { stored: false, reason: "own message" }; // outbound mail is saved by the send handler
  if (m.chatType !== "direct" && m.chatType !== "group") return { stored: false, reason: "not a chat" };
  const known = await findKnown(m.sender.number);
  if (!known) return { stored: false, reason: "number not on the allow-list" };

  const db = admin();
  const externalId = `wa:${m.id}`;
  const { data: seen } = await db.from("messages").select("id").eq("external_id", externalId).maybeSingle();
  if (seen) return { stored: false, reason: "already stored" };

  const voice = m.kind === "voice" || m.kind === "audio";
  // A voice note is kept and shown. It is not transcribed yet (speech to text comes later).
  const body = voice ? "[Voice note. Not transcribed yet.]" : m.text;
  const match = known.who === "vendor" ? await matchVendor(known.vendorId!, m.text) : null;

  const { data: msg, error } = await db.from("messages").insert({
    case_id: match?.caseId ?? null, channel: "whatsapp", direction: "in", external_id: externalId, thread_id: m.chatJid,
    sender: digits(m.sender.number), recipients: [], subject: null, body, language: null,
    classification: voice ? "voice_note" : match ? "vendor_reply" : null,
    sender_verified: true, // WhatsApp identifies the sender. The number is on our allow-list.
    created_at: m.timestamp,
  }).select("id").single();
  if (error) { if (error.code === "23505") return { stored: false, reason: "already stored" }; throw error; }

  const opts = { caseId: match?.caseId, actor: "whatsapp" };
  const events: (() => Promise<void>)[] = [() => emit("message.stored", { message_id: msg.id, case_id: match?.caseId }, opts)];
  try {
    if (m.media) {
      const f = await downloadMedia(m.id);
      const sha = createHash("sha256").update(f.data).digest("hex");
      const name = safeName(m.media.fileName ?? f.fileName ?? `${m.kind}-${m.id}`);
      const path = `whatsapp/${safeName(m.id)}/${sha.slice(0, 12)}-${name}`;
      const up = await db.storage.from(BUCKET).upload(path, f.data, { contentType: f.mimetype, upsert: true });
      if (up.error) throw new Error(`could not store the file: ${up.error.message}`);
      const mime = m.media.mimetype ?? f.mimetype;
      const { data: doc, error: de } = await db.from("documents").insert({
        case_id: match?.caseId ?? null, message_id: msg.id, filename: name, mime, storage_path: path, sha256: sha,
        kind: voice ? "voice" : match && QUOTE_TYPES.test(mime) ? "quote" : null,
      }).select("id").single();
      if (de && de.code !== "23505") throw de;
      if (doc) {
        events.push(() => emit("document.stored", { document_id: doc.id, message_id: msg.id }, opts));
        if (match && QUOTE_TYPES.test(mime)) events.push(() => emit("quote.received", { case_id: match.caseId, rfq_id: match.rfqId, vendor_id: match.vendorId, document_id: doc.id }, opts));
      }
    }
  } catch (e) {
    // The message row means "seen". If the file failed, remove the row so the bridge can send it again.
    await db.from("documents").delete().eq("message_id", msg.id);
    await db.from("messages").delete().eq("id", msg.id);
    throw e;
  }
  // Triage reads messages that no rule claimed. Voice notes wait for speech to text.
  if (!voice && !match) events.push(() => emit("message.received", { message_id: msg.id }, opts));
  for (const send of events) await send();
  return { stored: true, messageId: msg.id };
}

/** A vendor's WhatsApp file belongs to its open RFQ. With one open RFQ that is clear. With several, the vendor must name
 *  the RFQ in the message (for example "RFQ-0032"). Otherwise a person decides. */
async function matchVendor(vendorId: string, text: string | null) {
  const db = admin();
  const { data } = await db.from("rfq_recipients").select("rfq_id, rfqs!inner(ref, case_id, status)").eq("vendor_id", vendorId).eq("status", "sent");
  let open = (data ?? []).filter(r => (r as any).rfqs.status === "sent");
  const named = /\b(RFQ-\d{3,6})\b/i.exec(text ?? "")?.[1]?.toUpperCase();
  if (named) open = open.filter(r => ((r as any).rfqs.ref ?? "").toUpperCase() === named);
  if (open.length !== 1) return null;
  return { rfqId: open[0].rfq_id as string, vendorId, caseId: (open[0] as any).rfqs.case_id as string };
}

export { sameNumber };
