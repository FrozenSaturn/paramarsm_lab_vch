import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildMatrix } from "./matrix";
import { comparativeWorkbook, col } from "./excel";
import { compareInputFromFixtures, fixtureVendorId as vid } from "./fixtures";
import { DEFAULT_WEIGHTS, PARAMS, type VendorScore } from "@/scoring/types";
import type { Matrix } from "./types";

/** Hand-made scores, so this test does not depend on the scoring code. */
function fakeScores(m: Matrix): VendorScore[] {
  return m.vendors.map((v, i) => {
    const params = PARAMS.map((p) => {
      const score = 50 + 10 * i;
      const weight = DEFAULT_WEIGHTS[p];
      return { param: p, score, weight, contribution: (score * weight) / 100, neutral: false, label: p === "past_performance" ? "no history" : null, explain: `test ${p}`, inputs: {} };
    });
    return {
      vendor_id: v.vendor_id,
      total: params.reduce((s, p) => s + p.contribution, 0),
      rank: m.vendors.length - i,
      params,
      risk_flags: v.vendor_id === vid("sk") ? [{ code: "unconfirmed_handwriting", severity: "warn", message: "Handwritten rates not confirmed" }] : [],
    };
  });
}

async function build() {
  const matrix = buildMatrix(compareInputFromFixtures());
  const buf = await comparativeWorkbook({
    matrix, scores: fakeScores(matrix), weights: DEFAULT_WEIGHTS,
    meta: { caseTitle: "Amara Tower-2 waterproofing", rfqRef: "DEV-B-RFQ-AMARA-WP", version: 1, createdAt: "2026-11-21T10:00:00.000Z" },
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return { matrix, buf, wb };
}

/** Row in column A or B whose text equals `label`. */
function findRow(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).text === label || ws.getCell(r, 2).text === label) return r;
  throw new Error(`no row "${label}"`);
}

test("comparative sheet: header, formulas with cached results, lowest and missing cells", async () => {
  const { matrix, wb } = await build();
  const ws = wb.getWorksheet("Comparative")!;
  assert.equal(ws.getCell("B2").value, "Amara Tower-2 waterproofing");
  assert.equal(ws.getCell("B3").value, "DEV-B-RFQ-AMARA-WP");
  assert.equal(ws.getCell("B5").value, "2026-11-21T10:00:00.000Z");
  assert.equal(ws.getCell("E8").value, "Bajrang Construction & Waterproofing");
  assert.equal(ws.getCell("E9").value, "Rate");

  // Vendor order in the sheet: Bajrang (E/F), Purvyakruti (G/H), S.K. (I/J), Shyama (K/L).
  const first = 10;
  assert.equal(ws.getCell(first, 1).value, "1");
  assert.equal(ws.getCell(first, 4).value, 13429.53);
  const f = ws.getCell(first, 6).value as ExcelJS.CellFormulaValue;
  assert.equal(f.formula, `ROUND(E${first}*$D${first},2)`);
  assert.equal(f.result, matrix.rows[0].cells[vid("bajrang")].amount);
  assert.equal(ws.getCell(first, 5).value, 34.5);
  // S.K. is lowest on line 1: highlighted.
  assert.equal((ws.getCell(first, 10).fill as ExcelJS.FillPattern).fgColor?.argb, "FFC6EFCE");
  assert.notEqual((ws.getCell(first, 6).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb, "FFC6EFCE");

  // Bajrang line 3: not comparable, loaded amount in the note.
  const l3 = ws.getCell(first + 2, 6);
  assert.equal(l3.value, "not comparable");
  assert.match(JSON.stringify(l3.note), /₹43,500\.00/);
  assert.equal(ws.getCell(first + 2, 5).value, "34.5 per SQM.");

  // Totals
  const tb = findRow(ws, "Total before GST");
  const before = ws.getCell(tb, 6).value as ExcelJS.CellFormulaValue;
  assert.equal(before.formula, `SUM(F${first}:F${first + 6})`);
  assert.equal(before.result, 1376412.01);
  const sk = ws.getCell(tb, 10).value as ExcelJS.CellFormulaValue;
  assert.equal(sk.result, 1381464);
  const lp = findRow(ws, "Landed for price");
  const price = ws.getCell(lp, 6).value as ExcelJS.CellFormulaValue;
  assert.match(price.formula, /^ROUND\(\(F\d+\+F\d+\)\*\(1\+F\d+\),2\)$/);
  assert.equal(price.result, matrix.totals[vid("bajrang")].landed_for_price);
  assert.equal(ws.getCell(findRow(ws, "Loading for missing lines"), 6).value, 43500);
  assert.equal((ws.getCell(lp, 10).fill as ExcelJS.FillPattern).fgColor?.argb, "FFC6EFCE"); // S.K. lowest landed for price
  assert.match(ws.getCell(tb, 6).numFmt, /₹/);

  // Terms and flags
  const gstRow = findRow(ws, "GST extra");
  assert.equal(ws.getCell(gstRow, 7).value, "met");
  assert.equal(ws.getCell(gstRow, 9).value, "not stated");
  assert.match(ws.getCell(findRow(ws, "Flags"), 5).text, /RFQ went out/); // Bajrang is stale
});

test("scores sheet: weights, contributions as formulas, totals, ranks and risk flags", async () => {
  const { matrix, wb } = await build();
  const ws = wb.getWorksheet("Scores")!;
  assert.equal(ws.getCell("A2").value, "Price");
  assert.equal(ws.getCell("B2").value, 40);
  assert.equal((ws.getCell(`B${2 + PARAMS.length}`).value as ExcelJS.CellFormulaValue).result, 100);
  const scores = fakeScores(matrix);
  let r = 1;
  while (ws.getCell(r, 1).text !== "Vendor") r++;
  r++;
  assert.equal(ws.getCell(r, 1).value, matrix.vendors[0].name);
  assert.equal(ws.getCell(r, 3).value, scores[0].params[0].score);
  assert.equal((ws.getCell(r, 5).value as ExcelJS.CellFormulaValue).formula, `ROUND(C${r}*D${r}/100,2)`);
  const totalRow = r + PARAMS.length;
  assert.equal(ws.getCell(totalRow, 2).value, "Total");
  assert.equal((ws.getCell(totalRow, 5).value as ExcelJS.CellFormulaValue).result, scores[0].total);
  assert.equal(ws.getCell(totalRow, 6).value, `Rank ${scores[0].rank}`);
  let found = false;
  ws.eachRow((row) => { if (/Handwritten rates not confirmed/.test(row.getCell(7).text)) found = true; });
  assert.ok(found);
});

test("sources sheet: one row per vendor per BOQ line, with page", async () => {
  const { matrix, wb } = await build();
  const ws = wb.getWorksheet("Sources")!;
  assert.equal(ws.rowCount, 1 + matrix.vendors.length * matrix.rows.length);
  assert.equal(ws.getCell("A2").value, "Bajrang Construction & Waterproofing");
  assert.equal(ws.getCell("B2").value, "quote-bajrang");
  assert.equal(ws.getCell("I2").value, 2); // Bajrang line 1 is on page 2
});

test("column letters", () => {
  assert.deepEqual([col(1), col(26), col(27), col(52), col(53)], ["A", "Z", "AA", "AZ", "BA"]);
});
