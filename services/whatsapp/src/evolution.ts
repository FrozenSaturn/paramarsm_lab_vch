// Thin client for the Evolution API v2 routes this service uses.
// Route list: evolution-api/src/api/routes/*.router.ts
import { config } from './config.ts';

export class EvolutionError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, route: string) {
    super(`Evolution ${route} failed with ${status}: ${JSON.stringify(body).slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.evolutionUrl}${route}`, {
    method,
    headers: { apikey: config.evolutionApiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Keep the raw text.
  }
  if (!res.ok) throw new EvolutionError(res.status, parsed, `${method} ${route}`);
  return parsed as T;
}

const enc = encodeURIComponent;

/** Events the bridge needs. History sync (MESSAGES_SET) stays in the Evolution database. */
export const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const;

export type QrPayload = { pairingCode?: string | null; code?: string; base64?: string; count?: number };
export type ConnectionState = { instance: { instanceName: string; state: 'open' | 'close' | 'connecting' } };

export const evolution = {
  ping: () => call<unknown>('GET', '/'),

  fetchInstances: (instanceName?: string) =>
    call<any[]>('GET', `/instance/fetchInstances${instanceName ? `?instanceName=${enc(instanceName)}` : ''}`),

  /**
   * Create an instance. With `number`, WhatsApp gives a pairing code in place of a QR scan.
   * readMessages stays false: the service must not send blue ticks for the user.
   */
  createInstance: (instanceName: string, number?: string) =>
    call<{ qrcode?: QrPayload; instance: unknown }>('POST', '/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(number ? { number } : {}),
      readMessages: false,
      readStatus: false,
      alwaysOnline: false,
      rejectCall: false,
      groupsIgnore: false,
      syncFullHistory: false,
    }),

  /** Returns a QR payload, or the state when the instance is already open. */
  connect: (instanceName: string, number?: string) =>
    call<QrPayload & Partial<ConnectionState>>(
      'GET',
      `/instance/connect/${enc(instanceName)}${number ? `?number=${enc(number)}` : ''}`,
    ),

  connectionState: (instanceName: string) =>
    call<ConnectionState>('GET', `/instance/connectionState/${enc(instanceName)}`),

  logout: (instanceName: string) => call<unknown>('DELETE', `/instance/logout/${enc(instanceName)}`),

  deleteInstance: (instanceName: string) => call<unknown>('DELETE', `/instance/delete/${enc(instanceName)}`),

  setWebhook: (instanceName: string) =>
    call<unknown>('POST', `/webhook/set/${enc(instanceName)}`, {
      webhook: {
        enabled: true,
        url: config.webhookUrl,
        byEvents: false,
        base64: true,
        headers: { 'x-webhook-secret': config.webhookSecret },
        events: WEBHOOK_EVENTS,
      },
    }),

  findChats: (instanceName: string) => call<any[]>('POST', `/chat/findChats/${enc(instanceName)}`, {}),

  findMessages: (instanceName: string, remoteJid: string, page = 1, offset = 50) =>
    call<{ messages: { total: number; pages: number; currentPage: number; records: any[] } }>(
      'POST',
      `/chat/findMessages/${enc(instanceName)}`,
      { where: { key: { remoteJid } }, page, offset },
    ),

  /** Download and decrypt the media of one message. Evolution finds it by key id. */
  getMedia: (instanceName: string, messageId: string, convertToMp4 = false) =>
    call<{ mediaType: string; fileName: string; mimetype: string; base64: string; caption?: string }>(
      'POST',
      `/chat/getBase64FromMediaMessage/${enc(instanceName)}`,
      { message: { key: { id: messageId } }, convertToMp4 },
    ),

  sendText: (instanceName: string, number: string, text: string, quotedId?: string) =>
    call<any>('POST', `/message/sendText/${enc(instanceName)}`, {
      number,
      text,
      ...(quotedId ? { quoted: { key: { id: quotedId } } } : {}),
    }),

  sendMedia: (
    instanceName: string,
    body: {
      number: string;
      mediatype: 'image' | 'document' | 'video' | 'audio';
      mimetype?: string;
      media: string; // URL or base64 without the data: prefix
      fileName?: string;
      caption?: string;
    },
  ) => call<any>('POST', `/message/sendMedia/${enc(instanceName)}`, body),
};
