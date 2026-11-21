import { admin } from "../lib/supabase";
import { normCode } from "../erp/hygiene";

/** Work category of a BOQ, read from its item codes. Plain rules, so the answer can be checked. */
const CATEGORY_BY_PREFIX: [RegExp, string][] = [[/^(WP|STP|UGR)/, "waterproofing"], [/^AQ/, "civil"]];
export function categoryOfCodes(codes: (string | null)[]): string | null {
  const votes = new Map<string, number>();
  for (const c of codes) { if (!c) continue; const n = normCode(c); const hit = CATEGORY_BY_PREFIX.find(([re]) => re.test(n)); if (hit) votes.set(hit[1], (votes.get(hit[1]) ?? 0) + 1); }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export interface ShortlistEntry { vendorId: string; name: string; email: string | null; why: string[]; rank: number }

/** Vendors in the category, best first: a stated category beats an inferred one, past RFQ replies add weight. The SOP needs at least 3. */
export async function shortlistVendors(category: string, max = 6): Promise<{ vendors: ShortlistEntry[]; warnings: string[] }> {
  const db = admin();
  const { data: cats } = await db.from("vendor_categories").select("vendor_id, inferred, vendors!inner(id, name)").eq("category", category);
  const ids = (cats ?? []).map(c => c.vendor_id as string);
  const warnings: string[] = [];
  if (!ids.length) return { vendors: [], warnings: [`No vendor has the category "${category}".`] };
  const [{ data: contacts }, { data: past }] = await Promise.all([
    db.from("vendor_contacts").select("vendor_id, email").in("vendor_id", ids).not("email", "is", null),
    db.from("rfq_recipients").select("vendor_id, status").in("vendor_id", ids),
  ]);
  const out: ShortlistEntry[] = (cats ?? []).map(c => {
    const why = [c.inferred ? `category "${category}" is a guess from the name` : `category "${category}" is stated`];
    const replied = (past ?? []).filter(p => p.vendor_id === c.vendor_id && p.status === "quoted").length;
    if (replied) why.push(`quoted on ${replied} earlier RFQ${replied > 1 ? "s" : ""}`);
    const email = (contacts ?? []).find(x => x.vendor_id === c.vendor_id)?.email ?? null;
    if (!email) why.push("no contact email");
    return { vendorId: c.vendor_id as string, name: (c as any).vendors.name as string, email, why, rank: (c.inferred ? 0 : 10) + replied * 2 + (email ? 5 : 0) };
  }).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  const usable = out.filter(v => v.email);
  if (usable.length < 3) warnings.push(`Only ${usable.length} vendor(s) can be invited. The SOP needs at least 3.`);
  return { vendors: out.slice(0, max), warnings };
}
