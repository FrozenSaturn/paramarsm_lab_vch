/**
 * Confirmations a person made on the review screen, laid over the model's raw reading.
 * Pure functions: no database, no auth. The write path is review.ts.
 */
import { HEADER_FIELDS, type ExtractedQuote, type HeaderField } from "./schema";

export interface Confirmation {
  value: string | number | null;
  /** What the model read, kept so the audit shows corrections. */
  original: string | number | null;
  by: string;
  at: string;
}
export type Confirmations = Record<string, Confirmation>;

export type ConfirmKey = `line:${string}:${"rate" | "quantity" | "unit"}` | `header:${HeaderField}`;

const isHeaderField = (a: string): a is HeaderField => (HEADER_FIELDS as readonly string[]).includes(a);

/**
 * The key comes from a form, so it is checked at runtime: a line field of a line that exists in
 * the reading, or a known header field. Anything else (e.g. "header:__proto__") is refused.
 */
export function parseConfirmKey(key: string, x: ExtractedQuote): ConfirmKey | null {
  const line = key.match(/^line:([^:]{1,20}):(rate|quantity|unit)$/);
  if (line) return x.lines.some((l) => l.serial.trim() === line[1]) ? (key as ConfirmKey) : null;
  const header = key.match(/^header:([a-z_]{1,40})$/);
  return header && isHeaderField(header[1]) ? (key as ConfirmKey) : null;
}

/** The reading with every confirmed value laid over it. Pure. */
export function applyConfirmations(x: ExtractedQuote, conf: Confirmations | null | undefined): ExtractedQuote {
  if (!conf || !Object.keys(conf).length) return x;
  const out: ExtractedQuote = structuredClone(x);
  for (const [key, c] of Object.entries(conf)) {
    const [kind, a, b] = key.split(":");
    if (kind === "line") {
      const line = out.lines.find((l) => l.serial.trim() === a);
      if (!line) continue;
      if (b === "rate") line.rate = c.value == null ? null : Number(c.value);
      else if (b === "quantity") line.quantity = c.value == null ? null : Number(c.value);
      else if (b === "unit" && c.value != null) line.unit = String(c.value);
      line.confidence = 1;
    } else if (kind === "header" && isHeaderField(a)) {
      const f = out.header[a];
      f.value = c.value == null ? null : String(c.value);
      f.confidence = 1;
    }
  }
  return out;
}

export const confirmedKeys = (conf: Confirmations | null | undefined) => new Set(Object.keys(conf ?? {}));

/** Original value for a key, read from the raw reading. */
export function originalValue(x: ExtractedQuote, key: string): string | number | null {
  const [kind, a, b] = key.split(":");
  if (kind === "line") {
    const l = x.lines.find((l) => l.serial.trim() === a);
    if (!l) return null;
    return b === "rate" ? l.rate : b === "quantity" ? l.quantity : b === "unit" ? l.unit : null;
  }
  return kind === "header" && isHeaderField(a) ? x.header[a].value : null;
}
