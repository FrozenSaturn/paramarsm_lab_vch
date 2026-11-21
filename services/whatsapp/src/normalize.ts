// Turns one Evolution message record into a WaMessage.
// The same shape comes from the webhook (messages.upsert, send.message) and from findMessages.

export type WaKind =
  | 'text'
  | 'voice' // push-to-talk voice note
  | 'audio' // audio file
  | 'image'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'poll'
  | 'other';

export type WaChatType = 'direct' | 'group' | 'status' | 'channel' | 'broadcast';

export type WaMedia = {
  mimetype: string | null;
  fileName: string | null;
  bytes: number | null;
  seconds: number | null;
  width: number | null;
  height: number | null;
  pages: number | null;
  /** Set after the bridge saves the file. Relative to DATA_DIR. */
  path?: string;
  sha256?: string;
};

/** The one message shape the bridge stores, serves and forwards. */
export type WaMessage = {
  id: string;
  instance: string;
  chatJid: string;
  chatType: WaChatType;
  fromMe: boolean;
  sender: {
    jid: string | null;
    /** Digits only. Null when WhatsApp gives a LID and no phone number. */
    number: string | null;
    name: string | null;
  };
  timestamp: string; // ISO 8601
  kind: WaKind;
  /** Body for text, caption for media, a readable summary for the other kinds. */
  text: string | null;
  media: WaMedia | null;
  quotedId: string | null;
  forwarded: boolean;
  /** Evolution messageType, kept for debugging. */
  rawType: string;
};

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const;

/** Remove wrapper layers, for example a disappearing-message wrapper. */
function unwrap(message: any): any {
  let m = message ?? {};
  for (let i = 0; i < 5; i++) {
    const key = WRAPPERS.find((w) => m[w]?.message);
    if (!key) break;
    m = m[key].message;
  }
  return m;
}

const SKIP_KEYS = new Set(['messageContextInfo', 'base64', 'speechToText', 'mediaUrl']);

function contentKey(m: any): string | null {
  return Object.keys(m).find((k) => !SKIP_KEYS.has(k) && m[k] != null) ?? null;
}

export function chatTypeOf(jid: string): WaChatType {
  if (jid.endsWith('@g.us')) return 'group';
  if (jid === 'status@broadcast') return 'status';
  if (jid.endsWith('@newsletter')) return 'channel';
  if (jid.endsWith('@broadcast')) return 'broadcast';
  return 'direct';
}

/** Digits of a phone-number JID. Null for a LID or a group JID. */
export function numberOf(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  return jid.split('@')[0].split(':')[0];
}

function pickPn(...jids: (string | null | undefined)[]): string | null {
  return jids.find((j) => j?.endsWith('@s.whatsapp.net')) ?? jids.find(Boolean) ?? null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v) || null;
  if (typeof v === 'object' && 'low' in (v as any)) return Number((v as any).low) >>> 0;
  return null;
}

function mediaOf(c: any): WaMedia {
  return {
    mimetype: c?.mimetype ?? null,
    fileName: c?.fileName ?? null,
    bytes: num(c?.fileLength),
    seconds: num(c?.seconds),
    width: num(c?.width),
    height: num(c?.height),
    pages: num(c?.pageCount),
  };
}

export function normalize(instance: string, raw: any): WaMessage | null {
  const key = raw?.key;
  if (!key?.id || !key?.remoteJid) return null;

  const m = unwrap(raw.message);
  const type: string =
    raw.messageType && m[raw.messageType] != null ? raw.messageType : (contentKey(m) ?? raw.messageType ?? 'unknown');
  if (type === 'protocolMessage' || type === 'senderKeyDistributionMessage') return null;
  const c = m[type];

  const chatJid: string = pickPn(key.remoteJid, key.remoteJidAlt)!;
  const chatType = chatTypeOf(chatJid);
  const senderJid = key.fromMe
    ? null
    : chatType === 'direct'
      ? chatJid
      : pickPn(key.participant, key.participantAlt, raw.participant);

  let kind: WaKind = 'other';
  let text: string | null = null;
  let media: WaMedia | null = null;

  switch (type) {
    case 'conversation':
      kind = 'text';
      text = typeof c === 'string' ? c : null;
      break;
    case 'extendedTextMessage':
      kind = 'text';
      text = c?.text ?? null;
      break;
    case 'imageMessage':
    case 'videoMessage':
    case 'documentMessage':
    case 'stickerMessage':
      kind = type.replace('Message', '') as WaKind;
      text = c?.caption ?? null;
      media = mediaOf(c);
      break;
    case 'audioMessage':
      kind = c?.ptt ? 'voice' : 'audio';
      media = mediaOf(c);
      break;
    case 'locationMessage':
    case 'liveLocationMessage':
      kind = 'location';
      text = [c?.name, c?.address, `${c?.degreesLatitude},${c?.degreesLongitude}`].filter(Boolean).join(' | ');
      break;
    case 'contactMessage':
      kind = 'contact';
      text = [c?.displayName, c?.vcard].filter(Boolean).join('\n');
      break;
    case 'contactsArrayMessage':
      kind = 'contact';
      text = (c?.contacts ?? []).map((x: any) => [x.displayName, x.vcard].filter(Boolean).join('\n')).join('\n\n');
      break;
    case 'reactionMessage':
      kind = 'reaction';
      text = c?.text ?? '';
      break;
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      kind = 'poll';
      text = [c?.name, ...(c?.options ?? []).map((o: any) => `- ${o.optionName}`)].join('\n');
      break;
  }

  const ctx = raw.contextInfo ?? c?.contextInfo ?? null;
  const ts = num(raw.messageTimestamp) ?? Math.floor(Date.now() / 1000);

  return {
    id: key.id,
    instance,
    chatJid,
    chatType,
    fromMe: !!key.fromMe,
    sender: {
      jid: senderJid,
      number: numberOf(senderJid),
      name: key.fromMe ? null : (raw.pushName ?? null),
    },
    timestamp: new Date(ts * 1000).toISOString(),
    kind,
    text,
    media,
    quotedId: type === 'reactionMessage' ? (c?.key?.id ?? null) : (ctx?.stanzaId ?? null),
    forwarded: !!ctx?.isForwarded,
    rawType: type,
  };
}

/** Base64 media that Evolution puts in the webhook when base64 is on. */
export function inlineBase64(raw: any): string | null {
  return raw?.message?.base64 ?? null;
}
