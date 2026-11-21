import ExcelJS from "exceljs";

export interface NewCodeRow { code: string; description: string; unit?: string | null; remarks?: string | null }

/** Farvision's item import layout is not public. These columns are a placeholder: replace them with the client's template.
 *  We only generate the sheet. A person uploads it. We never write to Farvision. */
export const IMPORT_LAYOUT_NOTE = "Placeholder layout. Replace the columns with the Farvision item import template before you upload.";

export async function buildItemImportSheet(rows: NewCodeRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Item Import");
  ws.addRow([IMPORT_LAYOUT_NOTE]).font = { italic: true, color: { argb: "FFB45309" } };
  const head = ws.addRow(["Item Code", "Item Description", "UOM", "Remarks"]);
  head.font = { bold: true };
  for (const r of rows) ws.addRow([r.code, r.description, r.unit ?? "", r.remarks ?? "Proposed by the procurement agent. Approved by a person."]);
  ws.columns = [{ width: 18 }, { width: 80 }, { width: 8 }, { width: 50 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Seam for the ERP. Today it builds a sheet. A real connector can replace it without touching the workflows. */
export interface ErpAdapter {
  listCodes(): Promise<{ code: string; description: string }[]>;
  proposeCodes(rows: NewCodeRow[]): Promise<{ kind: "sheet"; buffer: Buffer }>;
}
export const sheetErp = (listCodes: ErpAdapter["listCodes"]): ErpAdapter => ({ listCodes, proposeCodes: async rows => ({ kind: "sheet", buffer: await buildItemImportSheet(rows) }) });
