/**
 * Writes the comparative statement to an Excel workbook (PLAN.md section 7.3).
 *
 * Every amount is an Excel formula with the cached result, so the sheet re-derives its
 * numbers. The workbook carries the stored creation time only: it never reads the clock.
 */
import ExcelJS from "exceljs";
import type { Matrix, MatrixVendor } from "./types";
import { PARAMS, PARAM_LABELS, type VendorScore, type Weights } from "@/scoring/types";
import { fmtINR } from "@/quotes/format";

export interface ComparativeWorkbookArgs {
  matrix: Matrix;
  scores: VendorScore[];
  weights: Weights;
  meta: { caseTitle: string; rfqRef: string | null; version: number; createdAt: string };
}

/** Rupees with Indian grouping (1,23,45,678.00). Excel allows two conditions, which covers up to 99 crore. */
export const INR_FORMAT = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
const RATE_FORMAT = "#,##0.00##";
const QTY_FORMAT = "#,##0.00";
const PCT_FORMAT = "0.00%";

const FILL_LOWEST: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
const FILL_MISSING: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
const FILL_HEAD: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const BOLD: Partial<ExcelJS.Font> = { bold: true };

/** Column letter for a 1-based column number. */
export function col(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Column of the vendor's rate (i is the vendor's 0-based position). Its amount is the next column. */
const rateCol = (i: number) => 5 + 2 * i;
const amountCol = (i: number) => 6 + 2 * i;

/** Builds the workbook and returns it as a Buffer. Sheets: Comparative, Scores, Sources. */
export async function comparativeWorkbook(args: ComparativeWorkbookArgs): Promise<Buffer> {
  const { matrix, meta } = args;
  const wb = new ExcelJS.Workbook();
  const created = new Date(meta.createdAt);
  wb.creator = "Vinayak procurement agent";
  wb.created = created;
  wb.modified = created;

  comparativeSheet(wb, args);
  scoresSheet(wb, args);
  sourcesSheet(wb, matrix);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function comparativeSheet(wb: ExcelJS.Workbook, { matrix, meta }: ComparativeWorkbookArgs) {
  const ws = wb.addWorksheet("Comparative", { views: [{ state: "frozen", xSplit: 4, ySplit: 9 }] });
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 48;
  ws.getColumn(3).width = 8;
  ws.getColumn(4).width = 14;
  matrix.vendors.forEach((_, i) => {
    ws.getColumn(rateCol(i)).width = 14;
    ws.getColumn(amountCol(i)).width = 18;
  });

  // Header block (rows 1 to 6)
  ws.getCell("A1").value = "Comparative statement";
  ws.getCell("A1").font = { bold: true, size: 14 };
  const header: [string, string | number][] = [
    ["Case", meta.caseTitle],
    ["RFQ", meta.rfqRef ?? "—"],
    ["Version", meta.version],
    ["Generated at", meta.createdAt],
    ["As of", matrix.as_of ?? "—"],
  ];
  header.forEach(([k, v], i) => {
    ws.getCell(2 + i, 1).value = k;
    ws.getCell(2 + i, 1).font = BOLD;
    ws.getCell(2 + i, 2).value = v;
  });

  // Column heads (rows 8 and 9)
  const H1 = 8, H2 = 9;
  ["Serial", "Description", "Unit", "Vinayak qty"].forEach((t, i) => {
    ws.mergeCells(H1, i + 1, H2, i + 1);
    ws.getCell(H1, i + 1).value = t;
  });
  matrix.vendors.forEach((v, i) => {
    ws.mergeCells(H1, rateCol(i), H1, amountCol(i));
    ws.getCell(H1, rateCol(i)).value = v.status === "needs_review" ? `${v.name} (needs review)` : v.name;
    ws.getCell(H2, rateCol(i)).value = "Rate";
    ws.getCell(H2, amountCol(i)).value = "Amount";
  });
  const lastCol = amountCol(matrix.vendors.length - 1);
  for (const r of [H1, H2]) for (let c = 1; c <= Math.max(lastCol, 4); c++) {
    const cell = ws.getCell(r, c);
    cell.font = BOLD;
    cell.fill = FILL_HEAD;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  // One row per BOQ line
  const first = H2 + 1;
  matrix.rows.forEach((row, ri) => {
    const r = first + ri;
    ws.getCell(r, 1).value = row.serial;
    ws.getCell(r, 2).value = row.description;
    ws.getCell(r, 2).alignment = { wrapText: true };
    ws.getCell(r, 3).value = row.unit ?? "";
    ws.getCell(r, 4).value = row.quantity;
    ws.getCell(r, 4).numFmt = QTY_FORMAT;
    matrix.vendors.forEach((v, i) => {
      const c = row.cells[v.vendor_id];
      const rc = ws.getCell(r, rateCol(i));
      const ac = ws.getCell(r, amountCol(i));
      if (c.amount != null && c.rate != null) {
        rc.value = c.rate;
        rc.numFmt = RATE_FORMAT;
        ac.value = { formula: `ROUND(${col(rateCol(i))}${r}*$D${r},2)`, result: c.amount };
        ac.numFmt = INR_FORMAT;
        if (c.lowest) { rc.fill = FILL_LOWEST; ac.fill = FILL_LOWEST; }
        if (c.handwritten) rc.note = c.confirmed ? "Handwritten rate, confirmed by a person." : "Handwritten rate, not yet confirmed by a person.";
      } else if (c.missing) {
        const notQuoted = c.flags.some((f) => f.code === "not_quoted");
        rc.value = c.rate_raw != null ? `${c.rate_raw} per ${c.unit_raw ?? "?"}` : null;
        ac.value = notQuoted ? "not quoted" : "not comparable";
        rc.fill = FILL_MISSING;
        ac.fill = FILL_MISSING;
        ac.note = c.loaded_amount != null
          ? `Loaded at ${fmtINR(c.loaded_amount)} (the highest amount of the other vendors on this line) for the price comparison.`
          : "No loading: no other vendor priced this line.";
      } else {
        rc.value = c.rate;
        if (c.rate != null) rc.numFmt = RATE_FORMAT;
        ac.value = null;
      }
    });
  });
  const last = first + matrix.rows.length - 1;

  // Totals
  let r = last + 1;
  const T_BEFORE = r++, T_RATE = r++, T_GST = r++, T_LANDED = r++, T_LOAD = r++, T_PRICE = r++;
  const labels: [number, string][] = [
    [T_BEFORE, "Total before GST"], [T_RATE, "GST rate"], [T_GST, "GST"], [T_LANDED, "Landed"],
    [T_LOAD, "Loading for missing lines"], [T_PRICE, "Landed for price"],
  ];
  for (const [row, label] of labels) {
    ws.mergeCells(row, 1, row, 4);
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = BOLD;
    ws.getCell(row, 1).alignment = { horizontal: "right" };
  }
  matrix.vendors.forEach((v, i) => {
    const t = matrix.totals[v.vendor_id];
    const a = col(amountCol(i));
    const sum = `SUM(${a}${first}:${a}${last})`;
    const inclusive = t.gst_basis === "inclusive";
    const set = (row: number, value: ExcelJS.CellValue, fmt = INR_FORMAT) => {
      const cell = ws.getCell(row, amountCol(i));
      cell.value = value;
      cell.numFmt = fmt;
      return cell;
    };
    set(T_BEFORE, { formula: inclusive ? `ROUND(${sum}/(1+${a}${T_RATE}),2)` : sum, result: t.before_gst });
    ws.getCell(T_RATE, rateCol(i)).value = t.gst_basis === "assumed_standard" ? "assumed" : t.gst_basis;
    set(T_RATE, t.gst_rate, PCT_FORMAT);
    set(T_GST, { formula: inclusive ? `ROUND(${sum}-${a}${T_BEFORE},2)` : `ROUND(${a}${T_BEFORE}*${a}${T_RATE},2)`, result: t.gst });
    set(T_LANDED, { formula: `${a}${T_BEFORE}+${a}${T_GST}`, result: t.landed });
    const load = set(T_LOAD, t.loading);
    if (t.lines_missing.length) load.note = `Missing line${t.lines_missing.length > 1 ? "s" : ""} ${t.lines_missing.join(", ")}, loaded at the highest amount of the other vendors.`;
    const price = set(T_PRICE, { formula: `ROUND((${a}${T_BEFORE}+${a}${T_LOAD})*(1+${a}${T_RATE}),2)`, result: t.landed_for_price });
    price.font = BOLD;
    if (matrix.lowest_landed_vendor_id === v.vendor_id) price.fill = FILL_LOWEST;
  });

  // Terms grid
  r = T_PRICE + 2;
  ws.getCell(r, 1).value = "RFQ terms";
  ws.getCell(r, 1).font = BOLD;
  r++;
  for (const t of matrix.terms) {
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = t.label;
    matrix.vendors.forEach((v, i) => {
      const c = t.cells[v.vendor_id];
      ws.getCell(r, rateCol(i)).value = c?.status.replace("_", " ") ?? "not stated";
      ws.getCell(r, amountCol(i)).value = c?.detail ?? null;
    });
    r++;
  }

  // Flags row: the warnings and blocks on each quote
  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = "Flags";
  ws.getCell(r, 1).font = BOLD;
  matrix.vendors.forEach((v, i) => {
    ws.mergeCells(r, rateCol(i), r, amountCol(i));
    const cell = ws.getCell(r, rateCol(i));
    cell.value = flagText(v) || "none";
    cell.alignment = { wrapText: true, vertical: "top" };
  });
  r += 2;

  // Notes
  if (matrix.notes.length) {
    ws.getCell(r, 1).value = "Notes";
    ws.getCell(r, 1).font = BOLD;
    r++;
    for (const n of matrix.notes) {
      ws.getCell(r, 1).value = "•";
      ws.getCell(r, 2).value = n;
      r++;
    }
  }
}

const flagText = (v: MatrixVendor) => v.flags.filter((f) => f.severity !== "info").map((f) => f.message).join("\n");

function scoresSheet(wb: ExcelJS.Workbook, { matrix, scores, weights }: ComparativeWorkbookArgs) {
  const ws = wb.addWorksheet("Scores");
  [24, 20, 10, 10, 14, 18, 70].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getCell("A1").value = "Weights";
  ws.getCell("A1").font = BOLD;
  PARAMS.forEach((p, i) => {
    ws.getCell(2 + i, 1).value = PARAM_LABELS[p];
    ws.getCell(2 + i, 2).value = weights[p];
  });
  ws.getCell(2 + PARAMS.length, 1).value = "Total";
  ws.getCell(2 + PARAMS.length, 1).font = BOLD;
  ws.getCell(2 + PARAMS.length, 2).value = { formula: `SUM(B2:B${1 + PARAMS.length})`, result: PARAMS.reduce((s, p) => s + weights[p], 0) };

  let r = PARAMS.length + 4;
  if (matrix.ranking_withheld) {
    ws.getCell(r, 1).value = "Ranking withheld: fewer than three quotes.";
    ws.getCell(r, 1).font = BOLD;
    r += 2;
  }
  const head = ["Vendor", "Parameter", "Score", "Weight", "Contribution", "Label", "Explanation"];
  head.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = BOLD;
    cell.fill = FILL_HEAD;
  });
  r++;
  const byVendor = new Map(scores.map((s) => [s.vendor_id, s]));
  for (const v of matrix.vendors) {
    const s = byVendor.get(v.vendor_id);
    if (!s) continue;
    const top = r;
    for (const p of s.params) {
      ws.getCell(r, 1).value = v.name;
      ws.getCell(r, 2).value = PARAM_LABELS[p.param];
      ws.getCell(r, 3).value = p.score;
      ws.getCell(r, 4).value = p.weight;
      ws.getCell(r, 5).value = { formula: `ROUND(C${r}*D${r}/100,2)`, result: p.contribution };
      ws.getCell(r, 6).value = p.label;
      ws.getCell(r, 7).value = p.explain;
      ws.getCell(r, 7).alignment = { wrapText: true };
      r++;
    }
    ws.getCell(r, 1).value = v.name;
    ws.getCell(r, 2).value = "Total";
    ws.getCell(r, 2).font = BOLD;
    ws.getCell(r, 5).value = { formula: `SUM(E${top}:E${r - 1})`, result: s.total };
    ws.getCell(r, 5).font = BOLD;
    ws.getCell(r, 6).value = s.rank != null ? `Rank ${s.rank}` : "Rank withheld";
    r++;
    ws.getCell(r, 1).value = v.name;
    ws.getCell(r, 2).value = "Risk flags";
    ws.getCell(r, 7).value = s.risk_flags.length ? s.risk_flags.map((f) => `[${f.severity}] ${f.message}`).join("\n") : "none";
    ws.getCell(r, 7).alignment = { wrapText: true };
    r += 2;
  }
}

function sourcesSheet(wb: ExcelJS.Workbook, matrix: Matrix) {
  const ws = wb.addWorksheet("Sources");
  const head = ["Vendor", "Quote id", "Version", "Document id", "Quote date", "Received at", "BOQ serial", "Quote line id", "Page", "Handwritten", "Confirmed"];
  [32, 38, 9, 38, 12, 26, 10, 38, 7, 12, 11].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  head.forEach((h, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = h;
    cell.font = BOLD;
    cell.fill = FILL_HEAD;
  });
  let r = 2;
  for (const v of matrix.vendors) {
    for (const row of matrix.rows) {
      const c = row.cells[v.vendor_id];
      ws.getRow(r).values = [
        v.name, v.quote_id, v.version, v.document_id ?? "", v.quote_date ?? "", v.received_at ?? "",
        row.serial, c.quote_line_id ?? "", c.page ?? "", c.handwritten ? "yes" : "no", c.confirmed ? "yes" : "no",
      ];
      r++;
    }
  }
}
