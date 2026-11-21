// File store for the test phase. One JSONL file per instance, media files beside it.
// The backend replaces this later: it takes each WaMessage from FORWARD_URL.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { config } from './config.ts';
import type { WaMessage } from './normalize.ts';

const EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

function safe(part: string): string {
  return part.replace(/[^\w.@-]/g, '_');
}

function extOf(mimetype: string | null, fileName: string | null): string {
  const base = (mimetype ?? '').split(';')[0].trim();
  if (EXT[base]) return EXT[base];
  const fromName = fileName?.match(/\.([\w]{1,8})$/)?.[1];
  return fromName ? fromName.toLowerCase() : 'bin';
}

const instanceDir = (instance: string) => path.join(config.dataDir, safe(instance));
const messagesFile = (instance: string) => path.join(instanceDir(instance), 'messages.jsonl');

const seen = new Map<string, Set<string>>();

async function seenSet(instance: string): Promise<Set<string>> {
  let set = seen.get(instance);
  if (set) return set;
  set = new Set();
  for (const msg of await readAll(instance)) set.add(msg.id);
  seen.set(instance, set);
  return set;
}

async function readAll(instance: string): Promise<WaMessage[]> {
  const file = messagesFile(instance);
  if (!existsSync(file)) return [];
  const out: WaMessage[] = [];
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Skip a broken line.
    }
  }
  return out;
}

export const store = {
  /** Append a message. Returns false when the id is already stored. */
  async add(msg: WaMessage): Promise<boolean> {
    const set = await seenSet(msg.instance);
    if (set.has(msg.id)) return false;
    set.add(msg.id);
    await mkdir(instanceDir(msg.instance), { recursive: true });
    await appendFile(messagesFile(msg.instance), JSON.stringify(msg) + '\n');
    return true;
  },

  /** Messages received by webhook, oldest first. */
  async list(instance: string, opts: { since?: string; chatJid?: string; limit?: number } = {}): Promise<WaMessage[]> {
    let all = await readAll(instance);
    if (opts.since) all = all.filter((m) => m.timestamp > opts.since!);
    if (opts.chatJid) all = all.filter((m) => m.chatJid === opts.chatJid);
    return all.slice(-(opts.limit ?? 200));
  },

  /** Save media bytes. Returns the path relative to DATA_DIR and the SHA-256. */
  async saveMedia(msg: WaMessage, bytes: Buffer, mimetype?: string | null): Promise<{ path: string; sha256: string }> {
    const dir = path.join(instanceDir(msg.instance), 'media');
    await mkdir(dir, { recursive: true });
    const name = `${safe(msg.id)}.${extOf(mimetype ?? msg.media?.mimetype ?? null, msg.media?.fileName ?? null)}`;
    const abs = path.join(dir, name);
    await writeFile(abs, bytes);
    return { path: path.relative(config.dataDir, abs), sha256: createHash('sha256').update(bytes).digest('hex') };
  },

  async readMedia(relPath: string): Promise<Buffer> {
    const abs = path.resolve(config.dataDir, relPath);
    if (!abs.startsWith(config.dataDir + path.sep)) throw new Error('Bad media path');
    return readFile(abs);
  },

  async logEvent(instance: string, event: string, data: unknown): Promise<void> {
    await mkdir(instanceDir(instance), { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), event, data });
    await appendFile(path.join(instanceDir(instance), 'events.jsonl'), line + '\n');
  },
};
