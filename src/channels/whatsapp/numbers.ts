import { admin } from "../../lib/supabase";

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Same phone number, ignoring the country code and punctuation. Compares the last 10 digits. */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a), y = digits(b);
  if (x.length < 8 || y.length < 8) return false;
  const n = Math.min(10, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
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
  for (const p of ppl ?? []) if (digits(p.phone)) out.push({ number: digits(p.phone), who: "person", personId: p.id, projectId: p.project_id });
  for (const v of vcs ?? []) if (digits(v.phone)) out.push({ number: digits(v.phone), who: "vendor", vendorId: v.vendor_id });
  for (const n of (process.env.WHATSAPP_ALLOW_NUMBERS ?? "").split(",")) if (digits(n)) out.push({ number: digits(n), who: "env" });
  return out;
}

export async function findKnown(number: string | null | undefined): Promise<KnownNumber | null> {
  if (!digits(number)) return null;
  return (await knownNumbers()).find(k => sameNumber(k.number, number)) ?? null;
}
