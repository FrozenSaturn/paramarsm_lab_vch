import ExcelJS from "exceljs";
import { RFQ_TERMS } from "../lib/rfq-terms";

export interface PackLine { serial: string | null; code: string | null; description: string; unit: string | null; quantity: number | null }

/** The sheet that goes to vendors: Vinayak's lines and quantities, the rate column empty, the six terms below. */
export async function buildBlankRateSheet(meta: { title: string; ref: string; dueDate: string }, lines: PackLine[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ - rates blank");
  ws.addRow([`${meta.title}`]).font = { bold: true, size: 13 };
  ws.addRow([`Reference: ${meta.ref}`, "", "", "", `Quote due: ${meta.dueDate}`]);
  ws.addRow(["Fill the yellow rate cells. Quote the rate for the unit shown. If you quote in another unit, write the unit next to the rate."]);
  ws.addRow([]);
  const head = ws.addRow(["Sl", "Item code", "Description", "UOM", "Quantity", "Rate (Rs.)", "Amount (Rs.)", "Remarks"]);
  head.font = { bold: true };
  let r = head.number;
  for (const l of lines) {
    r++;
    const row = ws.addRow([l.serial, l.code, l.description, l.unit, l.quantity == null ? null : Math.round(l.quantity * 100) / 100, null,
      { formula: `IF(F${r}="","",E${r}*F${r})` }, l.quantity == null ? "Quantity to be confirmed by Vinayak" : null]);
    row.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  }
  ws.addRow([]);
  ws.addRow(["Terms"]).font = { bold: true };
  RFQ_TERMS.forEach((t, i) => ws.addRow([i + 1, t.text]));
  ws.columns = [{ width: 6 }, { width: 14 }, { width: 70 }, { width: 8 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 34 }];
  ws.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The RFQ mail. The subject carries [VIN-RFQ-####] so a reply that starts a new thread can still be matched. */
export function buildRfqMail(m: { title: string; ref: string; dueDate: string; sender: string }): { subject: string; body: string } {
  return {
    subject: `SEEKING QUOTATION FOR ${m.title.toUpperCase()} [VIN-${m.ref}]`,
    body: [
      "Dear Sir,", "",
      "Please find attached the description of work along with this mail. You are requested to kindly submit your commercial quotation in accordance with the specifications mentioned in the attached file as well as the points below.", "",
      ...RFQ_TERMS.map((t, i) => `${i + 1}. ${t.text}`), "",
      `Please send your quotation by ${m.dueDate}. Reply to this mail and keep the subject line as it is.`, "",
      "Thanks & Regards,", m.sender,
    ].join("\n"),
  };
}
