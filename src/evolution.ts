import { cfg } from "./config.js";

export type Incoming = {
  id: string; from: string; name: string;
  kind: "text" | "audio" | "image" | "document" | "other";
  text?: string; mimetype?: string; fileName?: string;
};

/** Parse an Evolution API `messages.upsert` webhook body. Returns null for ignorable events. */
export function parseWebhook(body: any): Incoming | null {
  if (body?.event !== "messages.upsert") return null;
  const d = body.data; if (!d?.key || d.key.fromMe) return null;
  const jid: string = d.key.remoteJid ?? "";
  if (jid.endsWith("@g.us") || jid.includes("status@")) return null; // no groups/status
  const from = (d.key.remoteJidAlt ?? jid).split("@")[0];
  const m = d.message ?? {};
  const base = { id: d.key.id as string, from, name: d.pushName ?? "" };
  const text = m.conversation ?? m.extendedTextMessage?.text;
  if (text) return { ...base, kind: "text", text };
  if (m.audioMessage) return { ...base, kind: "audio", mimetype: m.audioMessage.mimetype };
  if (m.imageMessage) return { ...base, kind: "image", mimetype: m.imageMessage.mimetype, text: m.imageMessage.caption };
  if (m.documentMessage) return { ...base, kind: "document", mimetype: m.documentMessage.mimetype, fileName: m.documentMessage.fileName, text: m.documentMessage.caption };
  return { ...base, kind: "other" };
}

export function senderAllowed(from: string) {
  return cfg.allowed.includes(from.replace(/\D/g, ""));
}

/** Ask Evolution API for the decrypted media of a message. */
export async function downloadMedia(messageId: string): Promise<Buffer> {
  const r = await fetch(`${cfg.evoUrl}/chat/getBase64FromMediaMessage/${cfg.instance}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: cfg.evoKey },
    body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
  });
  if (!r.ok) throw new Error(`Evolution media download failed: ${r.status} ${await r.text()}`);
  const j: any = await r.json();
  if (!j.base64) throw new Error("Evolution returned no base64");
  return Buffer.from(j.base64, "base64");
}
