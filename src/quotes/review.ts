/**
 * The review screen's write path. A person confirms or corrects a value the model read;
 * the confirmation is kept on the quote (quotes.confirmations), applied over the raw
 * reading (which is never edited), and the quote is normalised again.
 */
import { admin } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { logStep } from "@/lib/steps";
import type { ExtractedQuote } from "./schema";
import type { HeaderField } from "./schema";

export interface Confirmation {
  value: string | number | null;
  /** What the model read, kept so the audit shows corrections. */
  original: string | number | null;
  by: string;
  at: string;
}
export type Confirmations = Record<string, Confirmation>;

export type ConfirmKey = `line:${string}:${"rate" | "quantity" | "unit"}` | `header:${HeaderField}`;

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
    } else if (kind === "header" && a in out.header) {
      const f = out.header[a as HeaderField];
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
  return kind === "header" && a in x.header ? x.header[a as HeaderField].value : null;
}

/**
 * Records a confirmation (value unchanged) or correction (new value) and re-normalises the quote.
 * Only the contracts engineer, the HOD and admin may confirm a reading; checked here, not in the UI.
 */
export async function confirmValue(quoteId: string, key: ConfirmKey, value: string | number | null) {
  const user = await requireRole("contracts_engineer", "hod", "admin");
  const db = admin();
  const { data: q, error } = await db.from("quotes").select("id,case_id,rfq_id,vendor_id,document_id,extraction,confirmations,second_read,model,status").eq("id", quoteId).single();
  if (error || !q) throw new Error("quote not found");
  if (!q.extraction) throw new Error("quote has not been read yet");
  const original = originalValue(q.extraction as ExtractedQuote, key);
  const conf: Confirmations = { ...(q.confirmations ?? {}), [key]: { value, original, by: user.id, at: new Date().toISOString() } };
  await db.from("quotes").update({ confirmations: conf }).eq("id", quoteId);

  const corrected = String(original) !== String(value);
  await logStep({
    caseId: q.case_id, workflow: "W5 quote intake", step: corrected ? `Corrected ${key}` : `Confirmed ${key}`,
    input: { quote_id: quoteId, key, read: original, value }, output: { by: user.email },
    reasoning: corrected ? `${user.email} changed ${key} from ${original} to ${value}` : `${user.email} confirmed ${key} = ${value}`,
  });

  // Re-normalise and re-save with the confirmations applied (dynamic import avoids a cycle with intake.ts).
  const { resaveQuote } = await import("./intake");
  return resaveQuote(quoteId);
}
