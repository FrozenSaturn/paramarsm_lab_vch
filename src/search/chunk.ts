/**
 * Splits text into chunks for search. Pure code: no database, no model.
 *
 * Rules:
 * - A chunk holds at most `maxChars` characters (about 900).
 * - The split prefers a paragraph break, then a sentence end, then a numbered item, then a space.
 * - The next chunk starts with the last sentences of the chunk before it (about `overlap` characters),
 *   so a fact that falls on a boundary is still found whole in one chunk.
 * - Each page is chunked alone, so each chunk keeps its page number.
 */
import { createHash } from "node:crypto";

export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

export interface PageChunk {
  /** 1-based page, or null for text without pages (a message body). */
  page: number | null;
  /** Position of the chunk in its source, from 0, across all pages. */
  chunk_index: number;
  content: string;
  content_hash: string;
}

const DEFAULT_MAX = 900;
const DEFAULT_OVERLAP = 150;

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Split one paragraph into sentence-sized units. Keeps the end mark on the sentence. */
export function splitSentences(paragraph: string): string[] {
  // A sentence ends at . ! ? or the Bengali/Hindi danda, before white space.
  // A new numbered item ("1 The", "12. GST", "a) Above") at the start of a line also starts a unit.
  const parts = paragraph
    .split(/(?<=[.!?।॥])\s+|\n(?=\s*(?:\d{1,3}[.)]?\s+[A-Z]|[a-z]\)\s*\S))/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts;
}

/** Cut a unit that is longer than max at spaces. A word longer than max is cut hard. */
function splitLong(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit];
  const out: string[] = [];
  let rest = unit;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The trailing units of a chunk whose total length is at most `overlap`. */
function tailUnits(units: string[], overlap: number): string[] {
  const tail: string[] = [];
  let len = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const add = units[i].length + (tail.length ? 1 : 0);
    if (len + add > overlap) break;
    tail.unshift(units[i]);
    len += add;
  }
  return tail;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const max = Math.max(50, opts.maxChars ?? DEFAULT_MAX);
  const overlap = Math.max(0, Math.min(opts.overlap ?? DEFAULT_OVERLAP, Math.floor(max / 2)));
  const clean = (text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];

  // Units in order; a null marks a paragraph break (a good place to end a chunk).
  const units: (string | null)[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    for (const s of splitSentences(para)) units.push(...splitLong(s, max));
    units.push(null);
  }

  const chunks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let fresh = 0; // units in `cur` that are not overlap from the previous chunk

  const flush = () => {
    if (fresh === 0) return;
    chunks.push(cur.join(" "));
    cur = tailUnits(cur, overlap);
    curLen = cur.join(" ").length;
    fresh = 0;
  };

  for (const u of units) {
    if (u === null) {
      // End the chunk at a paragraph break when it is already more than half full.
      if (curLen >= max * 0.6) flush();
      continue;
    }
    const add = u.length + (cur.length ? 1 : 0);
    if (curLen + add > max && fresh > 0) flush();
    // The overlap plus this unit can still be too long: drop overlap units from the front.
    while (cur.length && curLen + u.length + 1 > max) {
      cur.shift();
      curLen = cur.join(" ").length;
    }
    cur.push(u);
    curLen = cur.join(" ").length;
    fresh++;
  }
  flush();
  return chunks;
}

/** Chunk each page alone and number the chunks across the whole source. */
export function chunkPages(pages: { page: number | null; text: string }[], opts: ChunkOptions = {}): PageChunk[] {
  const out: PageChunk[] = [];
  for (const p of pages) {
    for (const content of chunkText(p.text, opts)) {
      out.push({ page: p.page, chunk_index: out.length, content, content_hash: contentHash(content) });
    }
  }
  return out;
}
