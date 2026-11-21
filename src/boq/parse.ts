/** Reads a BOQ sheet cell by cell. Numbers come from cells, never from a model. */
import ExcelJS from "exceljs";

export interface BoqLineIn {
  row: number; serial: string; siteCode: string | null; description: string; unit: string | null;
  quantity: number | null; parts: { label: string; value: number | null }[]; totalSft: number | null;
}
export interface BoqParsed { sheet: string; lines: BoqLineIn[]; grandTotal: { label: string; value: number | null; unit: string | null } | null; warnings: string[] }

const cellValue = (c: ExcelJS.Cell): unknown => { const v: any = c.value; return v && typeof v === "object" && "result" in v ? v.result : v && typeof v === "object" && "richText" in v ? v.richText.map((t: any) => t.text).join("") : v; };
const text = (c: ExcelJS.Cell) => { const v = cellValue(c); return v == null ? "" : String(v).replace(/\s+/g, " ").trim(); };
const numeric = (c: ExcelJS.Cell) => { const v = cellValue(c); return typeof v === "number" && Number.isFinite(v) ? v : null; };

const QTY_PRIORITY: RegExp[] = [/total.*\(sqm\)|total qty|^total \(/i, /^qty\.?$/i, /net qty/i, /quantity/i];

export async function parseBoq(buf: Buffer): Promise<BoqParsed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  // The BOQ sheet is the first sheet that has a description column and a unit column in its first 30 rows.
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
      const cells = ws.getRow(r);
      const cols = cells.cellCount;
      const hasDesc = Array.from({ length: cols }, (_, i) => text(cells.getCell(i + 1))).some(t => /desc/i.test(t));
      const hasUnit = Array.from({ length: cols }, (_, i) => text(cells.getCell(i + 1))).some(t => /^(uom|unit)$/i.test(t));
      if (hasDesc && hasUnit) return readSheet(ws, r);
    }
  }
  throw new Error("No BOQ table found: need a header row with a description column and a UOM column.");
}

function readSheet(ws: ExcelJS.Worksheet, hr: number): BoqParsed {
  const warnings: string[] = [];
  const width = ws.columnCount;
  // Some sheets use two header rows. A cell in the second row is the more specific name.
  const second = ws.getRow(hr + 1);
  const twoRows = Array.from({ length: width }, (_, i) => text(second.getCell(i + 1))).some(t => /^(net qty|qty|rate|amt)/i.test(t));
  const header = (i: number) => (twoRows && text(second.getCell(i)) ? text(second.getCell(i)) : text(ws.getRow(hr).getCell(i)));
  const heads = Array.from({ length: width }, (_, i) => header(i + 1));
  const col = (re: RegExp) => heads.findIndex(h => re.test(h)) + 1 || null;

  const cDesc = col(/desc/i), cUnit = col(/^(uom|unit)$/i), cSerial = col(/^sl/i), cCode = col(/^(wo code|item alias|item code)$/i);
  const cSft = col(/total.*\(sft\)|total.*sqft/i);
  let cQty: number | null = null;
  for (const re of QTY_PRIORITY) { cQty = col(re); if (cQty) break; }
  if (!cDesc || !cUnit || !cQty) throw new Error(`BOQ header not understood (description: ${!!cDesc}, unit: ${!!cUnit}, quantity: ${!!cQty}).`);
  // Part columns sit between the unit column and the quantity column, for example "FLAT - A".
  const partCols = heads.map((h, i) => ({ h, i: i + 1 })).filter(x => x.i > cUnit && x.i < cQty! && /flat|block|tower|floor|gf|part/i.test(x.h));

  const lines: BoqLineIn[] = [];
  let grandTotal: BoqParsed["grandTotal"] = null;
  for (let r = hr + (twoRows ? 2 : 1); r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const first = text(row.getCell(1));
    if (/grand total|^total\b/i.test(first) || /grand total/i.test(text(row.getCell(cDesc)))) {
      grandTotal = { label: first || text(row.getCell(cDesc)), value: numeric(row.getCell(cQty)), unit: text(row.getCell(cUnit)) || null };
      continue;
    }
    const description = text(row.getCell(cDesc));
    const serialRaw = cSerial ? cellValue(row.getCell(cSerial)) : null;
    if (!description || typeof serialRaw !== "number") continue; // section titles and notes have no numeric serial
    lines.push({
      row: r, serial: String(serialRaw), siteCode: cCode ? text(row.getCell(cCode)) || null : null, description, unit: text(row.getCell(cUnit)) || null,
      quantity: numeric(row.getCell(cQty)), parts: partCols.map(p => ({ label: p.h, value: numeric(row.getCell(p.i)) })),
      totalSft: cSft ? numeric(row.getCell(cSft)) : null,
    });
  }
  if (!lines.length) warnings.push("The table has a header but no numbered lines.");
  return { sheet: ws.name, lines, grandTotal, warnings };
}
