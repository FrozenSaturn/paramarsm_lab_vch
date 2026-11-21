// Test client for the bridge. Run: npm run wa -- <command>
import qrcode from 'qrcode-terminal';

const BRIDGE = (process.env.BRIDGE_URL ?? `http://localhost:${process.env.BRIDGE_PORT ?? 8091}`).replace(/\/$/, '');
const TOKEN = process.env.BRIDGE_TOKEN ?? '';
const INSTANCE = process.env.INSTANCE_NAME ?? 'vch-main';

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inst = `/instances/${INSTANCE}`;

function line(m: any): string {
  const who = m.fromMe ? 'me' : (m.sender?.name ?? m.sender?.number ?? m.sender?.jid ?? '?');
  const media = m.media ? ` [${m.media.mimetype ?? 'media'}${m.media.path ? ` saved ${m.media.path}` : ''}]` : '';
  return `${m.timestamp}  ${m.id}  ${who}: <${m.kind}> ${m.text ?? ''}${media}`;
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  /** link [number]  Show a QR code, or a pairing code when a number is given. Waits until linked. */
  async link([number]) {
    let s = await api('POST', `${inst}/link`, { number });
    let shownCode: string | null = null;
    let shownQr: string | null = null;
    for (let i = 0; i < 120 && s.state !== 'open'; i++) {
      if (s.pairingCode && s.pairingCode !== shownCode) {
        shownCode = s.pairingCode;
        console.log(`\nPairing code: ${s.pairingCode.replace(/(.{4})(.{4})/, '$1-$2')}`);
        console.log('WhatsApp > Linked devices > Link a device > Link with phone number instead.');
      } else if (!s.pairingCode && s.qrCode && s.qrCode !== shownQr) {
        shownQr = s.qrCode;
        qrcode.generate(s.qrCode, { small: true });
        console.log('Scan in WhatsApp > Linked devices > Link a device. The code changes every ~20 s.');
      }
      await sleep(2500);
      s = await api('GET', `${inst}/status`);
    }
    if (s.state === 'open') console.log(`\nLinked: ${s.profileName ?? ''} +${s.number ?? ''}`);
    else console.log(`\nNot linked. State: ${s.state}`);
  },

  async status() {
    console.log(await api('GET', `${inst}/status`).then(({ qr, ...rest }) => rest));
  },

  async instances() {
    console.table(await api('GET', '/instances'));
  },

  /** chats [n]  The newest chats from the WhatsApp history sync. */
  async chats([n = '20']) {
    const chats: any[] = await api('GET', `${inst}/chats`);
    chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const ch of chats.slice(0, Number(n))) {
      const last = ch.lastMessage ? `<${ch.lastMessage.kind}> ${(ch.lastMessage.text ?? '').slice(0, 50)}` : '';
      console.log(`${ch.type.padEnd(6)} ${ch.jid.padEnd(32)} ${(ch.name ?? '').slice(0, 24).padEnd(24)} ${last}`);
    }
    console.log(`\n${chats.length} chats`);
  },

  /** messages <jid> [limit]  Messages of one chat from the history, newest first. */
  async messages([jid, limit = '30']) {
    if (!jid) throw new Error('Usage: messages <jid> [limit]');
    const res = await api('GET', `${inst}/chats/${encodeURIComponent(jid)}/messages?limit=${limit}`);
    for (const m of res.messages) console.log(line(m));
    console.log(`\n${res.messages.length} of ${res.total}`);
  },

  /** inbox  Messages that came in by webhook. Follows new ones. */
  async inbox() {
    let since = '';
    for (;;) {
      const list: any[] = await api('GET', `${inst}/inbox?limit=50${since ? `&since=${encodeURIComponent(since)}` : ''}`);
      for (const m of list) console.log(line(m));
      if (list.length) since = list[list.length - 1].timestamp;
      await sleep(2000);
    }
  },

  /** media <messageId> <outFile>  Download the media of a message. */
  async media([id, out]) {
    if (!id || !out) throw new Error('Usage: media <messageId> <outFile>');
    const res = await fetch(`${BRIDGE}${inst}/messages/${encodeURIComponent(id)}/media`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    console.log(`Saved ${out} (${res.headers.get('content-type')})`);
  },

  /** send <number> <text...>  Send a text message. */
  async send([to, ...words]) {
    if (!to || !words.length) throw new Error('Usage: send <number> <text>');
    console.log(await api('POST', `${inst}/send/text`, { to, text: words.join(' ') }));
  },

  /** logout  Unlink the phone. */
  async logout() {
    console.log(await api('DELETE', inst));
  },
};

const [cmd, ...args] = process.argv.slice(2);
const fn = commands[cmd ?? ''];
if (!fn) {
  console.log('Commands: link [number] | status | instances | chats [n] | messages <jid> [limit] | inbox | media <id> <file> | send <number> <text> | logout');
  process.exit(cmd ? 1 : 0);
}
fn(args).catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
