import { admin } from "../../lib/supabase";
import { mailboxKey } from "./auth-results";

/** Who may put mail into the system: site people, vendor contacts, and GMAIL_ALLOW_SENDERS (comma separated).
 *  If GMAIL_ALLOW_SENDERS is not set at all, every sender is allowed (the old behaviour). Set it, even to one address. */
export function allowListConfigured() { return process.env.GMAIL_ALLOW_SENDERS !== undefined && process.env.GMAIL_ALLOW_SENDERS !== null; }

export async function allowedSenders(): Promise<Set<string>> {
  const db = admin();
  const [{ data: ppl }, { data: vcs }] = await Promise.all([db.from("people").select("email").not("email", "is", null), db.from("vendor_contacts").select("email").not("email", "is", null)]);
  const keys = new Set<string>();
  for (const e of [...(ppl ?? []).map(p => p.email), ...(vcs ?? []).map(v => v.email), ...(process.env.GMAIL_ALLOW_SENDERS ?? "").split(",")]) {
    const k = e ? mailboxKey(e) : null;
    if (k) keys.add(k);
  }
  return keys;
}

export async function senderAllowed(from: string | null): Promise<boolean> {
  if (!allowListConfigured()) return true;
  const k = from ? mailboxKey(from) : null;
  return !!k && (await allowedSenders()).has(k);
}
