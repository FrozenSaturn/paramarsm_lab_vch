// Person A's seed: identity, projects, people, vendors, item codes, the Amara BOQ and two closed past cases.
// Safe to re-run: every row is found by a natural key and updated, never duplicated.
import ExcelJS from "exceljs";
import path from "node:path";
import type pg from "pg";
import { upsert } from "../db";

const DATA = path.resolve("vinayak-vch3-data");
const val = (c: ExcelJS.Cell) => { const v: any = c.value; return v && typeof v === "object" && "result" in v ? v.result : v; };
const str = (c: ExcelJS.Cell) => { const v = val(c); return v == null ? null : String(v).trim().replace(/\s+/g, " ") || null; };
const num = (c: ExcelJS.Cell) => { const v = val(c); return typeof v === "number" ? v : null; };
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
async function sheet(file: string, name?: string) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(DATA, file));
  return name ? wb.getWorksheet(name)! : wb.worksheets[0];
}

// ---- who may sign in. SEED_USERS="you@gmail.com:contracts_engineer,partner@gmail.com:hod" ----
export async function seedUsers(db: pg.Client) {
  const spec = (process.env.SEED_USERS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!spec.length) console.warn("  ! SEED_USERS not set: nobody can sign in until allowed_users has rows");
  for (const s of spec) {
    const [email, role] = s.split(":");
    await db.query(`insert into allowed_users (email, role) values ($1, $2::app_role_t) on conflict (email) do update set role = excluded.role`, [email.toLowerCase(), role]);
  }
  return spec.length;
}

export async function seedProjects(db: pg.Client) {
  const ids: Record<string, string> = {};
  for (const name of ["Vinayak Amara", "Vinayak Aquina", "Vinayak 21 Acres"])
    ids[name] = await upsert(db, "projects", { name }, { source: "named in site emails", is_demo: true });
  // Names and titles exactly as signed in the two site emails; other CC'd people have no stated title.
  const people: [string, string | null, string | null][] = [
    ["Soham Saha", "Sr. Engineer, Contracts & Planning", null], ["Arijit Dey", "QS & Billing Engineer", "Vinayak Amara"],
    ["Molay Kumar Das", "Project Manager (Aquina & Amara)", "Vinayak Amara"], ["Dipon Senapati", "QS & Billing Engineer", "Vinayak Aquina"],
    ["Rishi Kyal", null, null], ["Anurag Kyal", null, null], ["Debabrata Sural", null, null],
  ];
  for (const [name, title, proj] of people)
    await upsert(db, "people", { name }, { title, project_id: proj ? ids[proj] : null, source: "site emails", is_demo: true });
  return ids;
}

const QUOTING = [
  { name: "Bajrang Construction & Waterproofing", slug: "bajrang", gstin: "19ABDFB3296M1ZY", address: "1/16 Majhipara Road, Thakurpukur, Kolkata - 700063", source: "Quotation_Bajrang_Construction.pdf" },
  { name: "Purvyakruti", slug: "purvyakruti", gstin: null, address: null, source: "Quotation_Purvyakruti.pdf (GSTIN/address not in text layer; fill from the letterhead)" },
  { name: "Shyama", slug: "shyama", gstin: null, address: null, source: "Quotation_Shyama.pdf (GSTIN/address not in text layer; fill from the letterhead)" },
  { name: "S.K. Construction", slug: "sk", gstin: null, address: "53 Shakti Pally, D.P. Nagar, Belghoria, Kolkata - 700056", source: "Quotation_SK_Construction.pdf (scan)" },
];
const CATEGORY_RULES: [RegExp, string][] = [
  [/ELECTRIC|ENERGY|TELEKOM|LIGHT/, "electrical"], [/LAB|TESTING|QUALIT/, "testing"], [/FIRE|SECURITY/, "fire_safety"],
  [/PILING|GEO/, "piling"], [/WATERLAND|ENVIRON|SAVE EARTH|GREEN/, "environmental"], [/PLASTICHEM|CHEM/, "chemicals"],
  [/INFRA|CONSTRUCTION|ENGINEERING|ENTERPRISE|UDYOG|CON\b/, "civil"],
];
const guess = (n: string) => CATEGORY_RULES.find(([re]) => re.test(n.toUpperCase()))?.[1] ?? "unclassified";

/** plus-address so every vendor mail lands in the one inbox we own. */
export const vendorEmail = (slug: string) => {
  const box = process.env.VENDOR_MAILBOX ?? "vendors@example.invalid";
  const [user, host] = box.split("@");
  return `${user}+${slug}@${host}`;
};

export async function seedVendors(db: pg.Client) {
  const ids: Record<string, string> = {};
  for (const v of QUOTING) {
    const id = ids[v.slug] = await upsert(db, "vendors", { name: v.name }, { gstin: v.gstin, address: v.address, source: v.source, is_demo: true });
    await upsert(db, "vendor_contacts", { vendor_id: id, email: vendorEmail(v.slug) }, { name: v.name });
    // They quoted waterproofing, so this is a fact from the quote, not a guess.
    await upsert(db, "vendor_categories", { vendor_id: id, category: "waterproofing" }, { inferred: false });
  }
  const ws = await sheet("05_vendors/Contractor_list_Aquina.xlsx");
  const taken = new Set(QUOTING.map(v => norm(v.name)));
  let n = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const name = str(ws.getCell(r, 1)); if (!name) continue;
    if (taken.has(norm(name))) continue; // e.g. "S K CONSTRUCTION" is the SK that quoted
    taken.add(norm(name));
    const id = await upsert(db, "vendors", { name }, { source: "Contractor_list_Aquina.xlsx", is_demo: true });
    // Heuristic from the name only; a model refines these later. Marked inferred so nobody mistakes it for fact.
    await upsert(db, "vendor_categories", { vendor_id: id, category: guess(name) }, { inferred: true });
    n++;
  }
  return { quoting: Object.keys(ids).length, aquina: n, ids };
}

export async function seedItemCodes(db: pg.Client) {
  const ws = await sheet("04_item_codes/ERP_item_codes_waterproofing.xlsx");
  let n = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const serial = num(ws.getCell(r, 1)), code = str(ws.getCell(r, 2)), desc = str(ws.getCell(r, 3));
    if (serial == null || !code || !desc) continue;
    // Duplicates and conflicting codes are kept on purpose: they are what the hygiene report must find.
    await upsert(db, "item_codes", { erp_serial: serial, source: "ERP_item_codes_waterproofing.xlsx" }, { code, description: desc, normalized_code: norm(code), is_demo: true });
    n++;
  }
  return n;
}

export async function seedAmaraBoq(db: pg.Client, projectId: string) {
  const caseId = await upsert(db, "cases", { title: "Waterproofing - Amara Tower-2" }, { project_id: projectId, stage: "requirement", status: "open", is_demo: true });
  const ver = await upsert(db, "boq_versions", { case_id: caseId, version: 1 }, { status: "draft" });
  const ws = await sheet("02_site_requirements/A_Amara_Waterproofing_quantities_Tower-2.xlsx", "WO ITEM-WISE BOQ");
  let n = 0;
  for (let r = 4; r <= 11; r++) {
    const serial = str(ws.getCell(r, 1)), site = str(ws.getCell(r, 2)), desc = str(ws.getCell(r, 3)), unit = str(ws.getCell(r, 5));
    if (!serial || !desc) continue;
    const qty = num(ws.getCell(r, 11)); // TOTAL (SQM); empty for lines site did not measure
    const flags: unknown[] = [{ type: "site_code", value: site }];
    if (qty == null) flags.push({ type: "not_measured", note: str(ws.getCell(r, 13)) });
    await upsert(db, "boq_lines", { boq_version_id: ver, serial }, { description: desc, unit, quantity: qty, flags: JSON.stringify(flags) });
    n++;
  }
  return { caseId, lines: n };
}

/** Made up, so the duplicate-tender alert and response-time history have something to find. */
export async function seedPastCases(db: pg.Client, projects: Record<string, string>, vendors: Record<string, string>) {
  const past = [
    { title: "Waterproofing - Aquina Block C (closed)", ref: "RFQ-0031", due: "2026-08-14", lines: [["WP.01", "WATERPROOFING AT TOILET FLOOR", "SQM", 980], ["WP.02", "WATERPROOFING AT TOILET WALL (UPTO 450 MM HIGHT)", "SQM", 840], ["WP.06", "WATERPROOFING AT BALCONY FLOOR", "SQM", 410]] },
    { title: "Waterproofing - 21 Acres Phase 2 (closed)", ref: "RFQ-0024", due: "2026-05-30", lines: [["WP.04", "WATERPROOFING AT KITCHEN FLOOR", "SQM", 260], ["WP.05", "WATERPROOFING AT KITCHEN WALL", "SQM", 230]] },
  ];
  const projFor = (t: string) => projects[t.includes("Aquina") ? "Vinayak Aquina" : "Vinayak 21 Acres"];
  for (const p of past) {
    const caseId = await upsert(db, "cases", { title: p.title }, { project_id: projFor(p.title), stage: "closed", status: "closed", is_demo: true });
    const ver = await upsert(db, "boq_versions", { case_id: caseId, version: 1 }, { status: "accepted" });
    let i = 1;
    for (const [code, desc, unit, qty] of p.lines) await upsert(db, "boq_lines", { boq_version_id: ver, serial: String(i++) }, { description: desc, unit, quantity: qty, item_code: code });
    const rfq = await upsert(db, "rfqs", { ref: p.ref }, { case_id: caseId, due_date: p.due, status: "closed", terms: JSON.stringify({ source: "made-up" }) });
    const sent = new Date(new Date(p.due).getTime() - 10 * 864e5).toISOString();
    for (const slug of Object.keys(vendors))
      await upsert(db, "rfq_recipients", { rfq_id: rfq, vendor_id: vendors[slug] }, { email: vendorEmail(slug), sent_at: sent, status: "quoted" });
  }
}
