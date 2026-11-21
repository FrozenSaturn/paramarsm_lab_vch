/**
 * The review screen's write path. A person confirms or corrects a value the model read;
 * the confirmation is kept on the quote (quotes.confirmations), applied over the raw
 * reading (which is never edited), and the quote is normalised again.
 */
import { admin } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { logStep } from "@/lib/steps";
import type { ExtractedQuote } from "./schema";
import { originalValue, parseConfirmKey, type Confirmations } from "./confirmations";
export * from "./confirmations";

/**
 * Records a confirmation (value unchanged) or correction (new value) and re-normalises the quote.
 * Only the contracts engineer, the HOD and admin may confirm a reading; checked here, not in the UI.
 */
export async function confirmValue(quoteId: string, rawKey: string, value: string | number | null) {
  const user = await requireRole("contracts_engineer", "hod", "admin");
  const db = admin();
  const { data: q, error } = await db.from("quotes").select("id,case_id,rfq_id,vendor_id,document_id,version,extraction,confirmations,second_read,model,status").eq("id", quoteId).single();
  if (error || !q) throw new Error("quote not found");
  if (!q.extraction) throw new Error("quote has not been read yet");
  // Only the live reading can be confirmed: not one still being read, failed, or replaced by a newer version.
  if (q.status !== "needs_review" && q.status !== "ready") throw new Error(`cannot confirm a quote that is ${q.status}`);
  const { data: newer } = await db.from("quotes").select("id").eq("case_id", q.case_id).eq("vendor_id", q.vendor_id).gt("version", q.version ?? 1).limit(1);
  if (newer?.length) throw new Error("a newer version of this quote exists; confirm values on that one");
  const key = parseConfirmKey(rawKey, q.extraction as ExtractedQuote);
  if (!key) throw new Error("not a field that can be confirmed");
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
