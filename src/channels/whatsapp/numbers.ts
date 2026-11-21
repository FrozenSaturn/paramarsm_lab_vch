import { admin } from "../../lib/supabase";

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** A full international number as digits: the country code and the number, 11 to 15 digits (E.164 allows up to 15).
 *  A number without its country code is refused: it could match a number in another country. */
export function normalizeNumber(s: string | null | undefined): string | null {
  const d = digits(s);
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Same phone number. Both must be full international numbers, and every digit must match. No suffix matching. */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeNumber(a), y = normalizeNumber(b);
  return !!x && !!y && x === y;
}

export interface KnownNumber { number: string; who: "person" | "vendor" | "env"; personId?: string; projectId?: string | null; vendorId?: string }

/** Numbers we talk to: site people, vendor contacts, and WHATSAPP_ALLOW_NUMBERS. Messages from any other number are dropped, not stored. */
export async function knownNumbers(): Promise<KnownNumber[]> {
  const db = admin();
  const [{ data: ppl }, { data: vcs }] = await Promise.all([
    db.from("people").select("id, phone, project_id").not("phone", "is", null),
    db.from("vendor_contacts").select("vendor_id, phone").not("phone", "is", null),
  ]);
  const out: KnownNumber[] = [];
  const bad: string[] = [];
  const take = (raw: string | null | undefined, k: Omit<KnownNumber, "number">) => { const n = normalizeNumber(raw); if (n) out.push({ number: n, ...k }); else if (digits(raw)) bad.push(String(raw)); };
  for (const p of ppl ?? []) take(p.phone, { who: "person", personId: p.id, projectId: p.project_id });
  for (const v of vcs ?? []) take(v.phone, { who: "vendor", vendorId: v.vendor_id });
  for (const n of (process.env.WHATSAPP_ALLOW_NUMBERS ?? "").split(",")) take(n, { who: "env" });
  // An entry without a country code never matches. Say so, so the mistake is easy to find.
  if (bad.length) console.warn(`[whatsapp] ${bad.length} allow-list entr${bad.length > 1 ? "ies" : "y"} ignored: a number needs its country code (11 to 15 digits).`);
  return out;
}

export async function findKnown(number: string | null | undefined): Promise<KnownNumber | null> {
  if (!digits(number)) return null;
  return (await knownNumbers()).find(k => sameNumber(k.number, number)) ?? null;
}
