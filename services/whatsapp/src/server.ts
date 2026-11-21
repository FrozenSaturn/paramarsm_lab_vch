import { timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { config } from './config.ts';
import { EvolutionError, evolution, type QrPayload } from './evolution.ts';
import { linkPage } from './link-page.ts';
import { chatTypeOf, inlineBase64, normalize, numberOf, type WaMessage } from './normalize.ts';
import { store } from './store.ts';

type LinkState = {
  state: 'open' | 'close' | 'connecting' | 'unknown';
  qr: QrPayload | null;
  owner: string | null;
  profileName: string | null;
  updatedAt: string;
};

const links = new Map<string, LinkState>();

function setLink(instance: string, patch: Partial<LinkState>): LinkState {
  const prev = links.get(instance) ?? { state: 'unknown', qr: null, owner: null, profileName: null, updatedAt: '' };
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  if (next.state === 'open') next.qr = null;
  links.set(instance, next);
  return next;
}

const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function instanceParam(c: Context): string {
  const name = c.req.param('name') ?? '';
  if (!NAME_RE.test(name)) throw new HttpError(400, 'Instance name must match [a-zA-Z0-9_-]{1,64}');
  return name;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function digits(v: string | undefined): string | undefined {
  const d = v?.replace(/\D/g, '');
  return d ? d : undefined;
}

// ---------- Ingest ----------

function allowed(msg: WaMessage): boolean {
  if (msg.chatType !== 'direct' && msg.chatType !== 'group') return false; // skip status and channels
  if (config.allowNumbers.length === 0) return true;
  const n = msg.fromMe ? numberOf(msg.chatJid) : msg.sender.number;
  return !!n && config.allowNumbers.includes(n);
}

async function forward(body: unknown): Promise<void> {
  if (!config.forwardUrl) return;
  try {
    const res = await fetch(config.forwardUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.forwardToken ? { authorization: `Bearer ${config.forwardToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`[forward] ${res.status} ${await res.text().catch(() => '')}`);
  } catch (err) {
    console.error('[forward] failed', err);
  }
}

/** Save the media file of a message. Uses the inline base64 first, then asks Evolution. */
async function attachMedia(msg: WaMessage, raw?: any): Promise<void> {
  if (!msg.media || msg.media.path) return;
  let b64 = raw ? inlineBase64(raw) : null;
  let mimetype = msg.media.mimetype;
  if (!b64) {
    const got = await evolution.getMedia(msg.instance, msg.id);
    b64 = got.base64;
    mimetype = got.mimetype ?? mimetype;
  }
  const saved = await store.saveMedia(msg, Buffer.from(b64, 'base64'), mimetype);
  msg.media.path = saved.path;
  msg.media.sha256 = saved.sha256;
}

async function ingestMessage(instance: string, raw: any): Promise<void> {
  const msg = normalize(instance, raw);
  if (!msg || !allowed(msg)) return;
  try {
    await attachMedia(msg, raw);
  } catch (err) {
    console.error(`[media] ${msg.id} not saved. GET the media route later.`, err);
  }
  if (!(await store.add(msg))) return;
  const who = msg.fromMe ? 'me' : (msg.sender.name ?? msg.sender.number ?? msg.sender.jid);
  console.log(`[msg] ${instance} ${msg.chatJid} ${who}: ${msg.kind}${msg.text ? ` "${msg.text.slice(0, 80)}"` : ''}`);
  await forward({ type: 'whatsapp.message', message: msg });
}

async function handleEvent(body: any): Promise<void> {
  const instance: string = body?.instance;
  const event: string = body?.event;
  const data = body?.data;
  if (!instance || !event) return;

  switch (event) {
    case 'messages.upsert':
    case 'send.message':
      for (const raw of Array.isArray(data) ? data : [data]) await ingestMessage(instance, raw);
      break;
    case 'qrcode.updated':
      setLink(instance, { state: 'connecting', qr: data?.qrcode ?? null });
      break;
    case 'connection.update': {
      const state = data?.state ?? 'unknown';
      const link = setLink(instance, {
        state,
        owner: data?.wuid ?? links.get(instance)?.owner ?? null,
        profileName: data?.profileName ?? links.get(instance)?.profileName ?? null,
      });
      console.log(`[conn] ${instance} ${state}${data?.statusReason ? ` reason=${data.statusReason}` : ''}`);
      await store.logEvent(instance, event, data);
      await forward({ type: 'whatsapp.connection', instance, state, owner: link.owner, reason: data?.statusReason ?? null });
      break;
    }
  }
}

// ---------- Link ----------

async function findInstance(name: string): Promise<any | null> {
  const all = await evolution.fetchInstances();
  return all.find((i) => i.name === name) ?? null;
}

async function refreshLink(name: string): Promise<LinkState> {
  const inst = await findInstance(name);
  if (!inst) return setLink(name, { state: 'unknown', qr: null });
  return setLink(name, {
    state: inst.connectionStatus ?? 'unknown',
    owner: inst.ownerJid ?? null,
    profileName: inst.profileName ?? null,
  });
}

/**
 * Create the instance when it does not exist, point its webhook at this bridge,
 * and start a link. With `number`, WhatsApp gives an 8-character pairing code.
 */
async function startLink(name: string, number?: string): Promise<LinkState> {
  let inst = await findInstance(name);

  if (inst?.connectionStatus === 'open') {
    await evolution.setWebhook(name);
    return refreshLink(name);
  }
  // Evolution gives a pairing code only on a fresh connect. Remove an unlinked instance first.
  if (inst && number) {
    await evolution.deleteInstance(name).catch(() => undefined);
    inst = null;
  }

  let qr: QrPayload | null = null;
  if (!inst) {
    const created = await evolution.createInstance(name, number);
    qr = created.qrcode ?? null;
    await evolution.setWebhook(name);
  } else {
    await evolution.setWebhook(name);
    const res = await evolution.connect(name, number);
    if (res.instance?.state === 'open') return refreshLink(name);
    qr = res;
  }
  return setLink(name, { state: 'connecting', qr: qr?.base64 || qr?.pairingCode ? qr : (links.get(name)?.qr ?? null) });
}

function linkView(name: string, l: LinkState) {
  return {
    instance: name,
    state: l.state,
    owner: l.owner,
    number: numberOf(l.owner),
    profileName: l.profileName,
    qr: l.qr?.base64 ?? null,
    qrCode: l.qr?.code ?? null,
    pairingCode: l.qr?.pairingCode ?? null,
    updatedAt: l.updatedAt,
  };
}

// ---------- HTTP ----------

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof EvolutionError) return c.json({ error: err.message, evolution: err.body }, 502);
  console.error(err);
  return c.json({ error: String(err) }, 500);
});

app.get('/health', async (c) => {
  const evo = await evolution.ping().then(
    () => true,
    () => false,
  );
  return c.json({ ok: true, evolution: evo });
});

app.post('/webhook/evolution', async (c) => {
  if (!safeEqual(c.req.header('x-webhook-secret') ?? '', config.webhookSecret)) return c.json({ error: 'bad secret' }, 401);
  const body = await c.req.json().catch(() => null);
  try {
    await handleEvent(body);
  } catch (err) {
    console.error('[webhook]', body?.event, err);
  }
  return c.json({ ok: true });
});

// The page holds no secret. It reads the token from the URL fragment, which the browser never sends.
app.get('/link/:name', (c) => c.html(linkPage(instanceParam(c))));

// Every route below needs the bridge token in the Authorization header. A query token can leak into logs.
app.use('*', async (c, next) => {
  const auth = c.req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token || !safeEqual(token, config.bridgeToken)) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

app.get('/instances', async (c) => {
  const all = await evolution.fetchInstances();
  return c.json(
    all.map((i) => ({
      instance: i.name,
      state: i.connectionStatus,
      owner: i.ownerJid ?? null,
      number: numberOf(i.ownerJid),
      profileName: i.profileName ?? null,
    })),
  );
});

app.post('/instances/:name/link', async (c) => {
  const name = instanceParam(c);
  const body = await c.req.json().catch(() => ({}));
  const number = digits(body?.number);
  return c.json(linkView(name, await startLink(name, number)));
});

app.get('/instances/:name/status', async (c) => {
  const name = instanceParam(c);
  const cached = links.get(name);
  // While a link is in progress the webhook keeps the cache fresh. Otherwise ask Evolution.
  const l = cached?.state === 'connecting' && cached.qr ? cached : await refreshLink(name);
  return c.json(linkView(name, l));
});

app.delete('/instances/:name', async (c) => {
  const name = instanceParam(c);
  await evolution.logout(name).catch(() => undefined);
  if (c.req.query('purge') === '1') await evolution.deleteInstance(name);
  links.delete(name);
  return c.json({ ok: true });
});

app.get('/instances/:name/chats', async (c) => {
  const name = instanceParam(c);
  const chats = await evolution.findChats(name);
  const out = chats
    .map((ch) => ({
      jid: ch.remoteJid as string,
      type: chatTypeOf(ch.remoteJid ?? ''),
      name: ch.pushName ?? ch.name ?? null,
      unread: ch.unreadCount ?? 0,
      updatedAt: ch.updatedAt ?? null,
      lastMessage: ch.lastMessage ? normalize(name, ch.lastMessage) : null,
    }))
    .filter((ch) => ch.jid && (ch.type === 'direct' || ch.type === 'group'));
  return c.json(out);
});

app.get('/instances/:name/chats/:jid/messages', async (c) => {
  const name = instanceParam(c);
  const jid = c.req.param('jid');
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)));
  const res = await evolution.findMessages(name, jid, page, limit);
  const records = res.messages?.records ?? [];
  return c.json({
    total: res.messages?.total ?? 0,
    pages: res.messages?.pages ?? 0,
    page: res.messages?.currentPage ?? page,
    messages: records.map((r) => normalize(name, r)).filter(Boolean),
  });
});

/** Messages that came in by webhook since the bridge started saving them. */
app.get('/instances/:name/inbox', async (c) => {
  const name = instanceParam(c);
  return c.json(
    await store.list(name, {
      since: c.req.query('since'),
      chatJid: c.req.query('chat'),
      limit: Math.min(1000, Number(c.req.query('limit') ?? 200)),
    }),
  );
});

/** The media file of one message. Downloads it from WhatsApp the first time. */
app.get('/instances/:name/messages/:id/media', async (c) => {
  const name = instanceParam(c);
  const id = c.req.param('id');
  const stored = (await store.list(name, { limit: 100000 })).find((m) => m.id === id);
  let rel = stored?.media?.path;
  let mimetype = stored?.media?.mimetype ?? 'application/octet-stream';
  let fileName = stored?.media?.fileName ?? null;

  if (!rel) {
    const got = await evolution.getMedia(name, id);
    const stub = { id, instance: name, media: { mimetype: got.mimetype, fileName: got.fileName } } as WaMessage;
    rel = (await store.saveMedia(stub, Buffer.from(got.base64, 'base64'), got.mimetype)).path;
    mimetype = got.mimetype ?? mimetype;
    fileName = got.fileName ?? fileName;
  }
  const bytes = await store.readMedia(rel);
  // The sender controls the mimetype. Show only known-safe types inline. Download the rest.
  const base = mimetype.split(';')[0].trim().toLowerCase();
  const inline = INLINE_TYPES.has(base) || base.startsWith('audio/');
  const outName = (fileName ?? rel.split('/').pop()!).replace(/[^\w.\- ]/g, '_');
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': inline ? base : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${outName}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
  });
});

function target(to: unknown): string {
  if (typeof to !== 'string' || !to) throw new HttpError(400, '`to` is required');
  if (to.includes('@')) return to; // a full JID, for example a group
  const d = digits(to);
  if (!d || d.length < 8) throw new HttpError(400, '`to` must be a phone number with country code');
  return d;
}

app.post('/instances/:name/send/text', async (c) => {
  const name = instanceParam(c);
  const body = await c.req.json();
  if (!body?.text) throw new HttpError(400, '`text` is required');
  const res = await evolution.sendText(name, target(body.to), String(body.text), body.quotedId);
  await store.logEvent(name, 'send.text', { to: body.to, id: res?.key?.id });
  return c.json({ ok: true, id: res?.key?.id ?? null });
});

app.post('/instances/:name/send/media', async (c) => {
  const name = instanceParam(c);
  const body = await c.req.json();
  if (!['image', 'document', 'video', 'audio'].includes(body?.mediatype)) {
    throw new HttpError(400, '`mediatype` must be image, document, video or audio');
  }
  if (!body?.media) throw new HttpError(400, '`media` (URL or base64) is required');
  const res = await evolution.sendMedia(name, {
    number: target(body.to),
    mediatype: body.mediatype,
    mimetype: body.mimetype,
    media: String(body.media).replace(/^data:[^;]+;base64,/, ''),
    fileName: body.fileName,
    caption: body.caption,
  });
  await store.logEvent(name, 'send.media', { to: body.to, id: res?.key?.id, fileName: body.fileName });
  return c.json({ ok: true, id: res?.key?.id ?? null });
});

// ---------- Start ----------

/** Point the webhook of each existing instance at this bridge. Evolution can start after us. */
async function syncWebhooks(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const all = await evolution.fetchInstances();
      for (const i of all) {
        await evolution.setWebhook(i.name);
        setLink(i.name, { state: i.connectionStatus ?? 'unknown', owner: i.ownerJid ?? null, profileName: i.profileName ?? null });
      }
      console.log(`[start] Evolution reachable. Webhook set on ${all.length} instance(s) -> ${config.webhookUrl}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error(`[start] Evolution not reachable at ${config.evolutionUrl}`);
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[start] bridge on :${info.port}. Link page: http://localhost:${info.port}/link/${config.defaultInstance}#token=<BRIDGE_TOKEN>`);
  void syncWebhooks();
});
