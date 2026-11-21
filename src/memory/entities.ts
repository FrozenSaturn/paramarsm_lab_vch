/**
 * Pure helpers for the memory layer: entity scopes, the sender allow-list, timeouts and
 * the local keyword rank. No database and no network here, so the tests run offline.
 *
 * An entity is a scope string: "vendor:<uuid>", "case:<uuid>", "project:<uuid>" or "user:<uuid>".
 * mem0 keeps each scope as its own user_id, so one scope never sees the memories of another.
 */

export type EntityKind = "vendor" | "case" | "project" | "user";
const KINDS: EntityKind[] = ["vendor", "case", "project", "user"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

export interface ParsedEntity {
  kind: EntityKind;
  id: string;
}

/** Parses "vendor:<uuid>". Returns null for any other shape. */
export function parseEntity(entity: string): ParsedEntity | null {
  const i = entity.indexOf(":");
  if (i <= 0) return null;
  const kind = entity.slice(0, i).trim().toLowerCase() as EntityKind;
  const id = entity.slice(i + 1).trim();
  if (!KINDS.includes(kind) || !id) return null;
  return { kind, id };
}

export const entity = (kind: EntityKind, id: string) => `${kind}:${id}`;

/** A key for "the same text": lower case, single spaces, no end punctuation. */
export const textKey = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[\s.!]+$/, "").trim();

/** The memory_refs columns that one entity fills. Only uuids go into uuid columns. */
export function entityColumns(e: string): { vendor_id: string | null; case_id: string | null } {
  const p = parseEntity(e);
  return {
    vendor_id: p?.kind === "vendor" && isUuid(p.id) ? p.id : null,
    case_id: p?.kind === "case" && isUuid(p.id) ? p.id : null,
  };
}

/** Removes bad and repeated entities and keeps the order. */
export function cleanEntities(entities: string[]): string[] {
  const out: string[] = [];
  for (const e of entities) {
    const p = parseEntity(e);
    if (!p) continue;
    const key = entity(p.kind, p.id);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// ---------- confidentiality: the sender allow-list (PLAN section 6) ----------

/** The last 10 digits of a phone number, or null. WhatsApp ids ("9198...@s.whatsapp.net") work too. */
export function phoneKey(s: string): string | null {
  const digits = s.replace(/@s\.whatsapp\.net$/i, "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** The email in "Name <a@b.c>" or "a@b.c", in lower case, or null. */
export function emailKey(s: string): string | null {
  const m = s.match(/<([^>]+)>/);
  const raw = (m ? m[1] : s).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && !raw.endsWith("@s.whatsapp.net") ? raw : null;
}

export interface Allowlist {
  emails: Set<string>;
  phones: Set<string>;
}

/** Reads MEM0_SENDER_ALLOWLIST: comma-separated emails and phone numbers. Empty means nobody. */
export function parseAllowlist(raw: string | undefined | null): Allowlist {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const v = part.trim();
    if (!v) continue;
    const e = emailKey(v);
    if (e) emails.add(e);
    else {
      const p = phoneKey(v);
      if (p) phones.add(p);
    }
  }
  return { emails, phones };
}

/**
 * True only when the sender is on the allow-list. Only demo-written content may go to the
 * mem0 cloud: the client's raw mail never does. An empty list sends nothing.
 */
export function senderAllowed(sender: string | null | undefined, list: Allowlist): boolean {
  if (!sender) return false;
  const e = emailKey(sender);
  if (e) return list.emails.has(e);
  const p = phoneKey(sender);
  return p ? list.phones.has(p) : false;
}

// ---------- timeouts ----------

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Rejects with TimeoutError when the promise takes longer than ms. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

// ---------- local keyword rank (the fallback when mem0 is down) ----------

/** Words of 3 or more letters, in lower case. Keeps Bengali and Devanagari letters. */
export function queryWords(q: string): string[] {
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return [...new Set(words)].slice(0, 8);
}

/** Character trigrams of a string, for a rough similarity in code. */
function trigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase().replace(/\s+/g, " ")} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Score in 0..1: the share of query words found in the text, plus a small trigram overlap term. */
export function overlapScore(query: string, text: string): number {
  const words = queryWords(query);
  const lower = text.toLowerCase();
  const hit = words.length ? words.filter((w) => lower.includes(w)).length / words.length : 0;
  const a = trigrams(query), b = trigrams(text);
  let common = 0;
  for (const g of a) if (b.has(g)) common++;
  const tri = a.size ? common / a.size : 0;
  return 0.8 * hit + 0.2 * tri;
}

/** Sorts rows by overlapScore, highest first, and drops rows with no word in common. */
export function rankByOverlap<T extends { text: string | null }>(query: string, rows: T[], limit: number): (T & { score: number })[] {
  const words = queryWords(query);
  return rows
    .map((r) => ({ ...r, score: overlapScore(query, r.text ?? "") }))
    .filter((r) => words.length === 0 || words.some((w) => (r.text ?? "").toLowerCase().includes(w)))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// ---------- which vendors a text names ----------

/** Words that do not identify a vendor on their own. */
const GENERIC = new Set([
  "the", "and", "shree", "shri", "sri", "new", "m/s", "ms", "construction", "constructions", "waterproofing", "enterprise",
  "enterprises", "engineering", "engineers", "services", "infra", "infrastructure", "builders", "traders", "trading",
  "company", "co", "pvt", "ltd", "private", "limited", "india", "group", "works", "agency", "agencies", "and co",
]);

/** The distinctive first word of a vendor name ("Bajrang" in "Bajrang Construction & Waterproofing"), or null. */
export function vendorKeyword(name: string): string | null {
  const words = name.toLowerCase().replace(/[.&,()]/g, " ").split(/\s+/).filter(Boolean);
  const w = words.find((x) => !GENERIC.has(x) && x.length >= 4);
  return w ?? null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Vendors whose full name, or distinctive first word, appears in the text as a whole word.
 * Short names such as "S.K." also match their dotted or plain form ("SK").
 */
export function vendorsMentioned<T extends { id: string; name: string }>(text: string, vendors: T[]): T[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const plain = t.replace(/\./g, "");
  const word = (w: string, s: string) => new RegExp(`(^|[^\\p{L}])${escapeRe(w)}([^\\p{L}]|$)`, "u").test(s);
  return vendors.filter((v) => {
    const full = v.name.toLowerCase().trim();
    if (full.length >= 4 && word(full, t)) return true;
    const kw = vendorKeyword(v.name);
    if (kw && word(kw, t)) return true;
    // Initials such as "S.K. Construction" -> "sk"
    const initials = full.match(/^((?:[a-z]\.){2,})/)?.[1]?.replace(/\./g, "");
    return !!initials && word(initials, plain);
  });
}
