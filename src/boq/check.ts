/** BOQ checks. Pure code: same BOQ in, same findings out. */
import type { BoqParsed } from "./parse";

export interface Finding { severity: "error" | "warn" | "info"; code: string; line?: string; message: string }

const KNOWN_UNITS = new Set(["SQM", "SQFT", "SFT", "RM", "RMT", "NOS", "NO", "CUM", "CUFT", "CFT", "KG", "MT", "TON", "LS", "LTR", "SET", "MTR", "M"]);
const SQM_TO_SFT = 10.7639;
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

export function checkBoq(b: BoqParsed, requirementText = ""): Finding[] {
  const f: Finding[] = [...b.warnings.map(m => ({ severity: "warn" as const, code: "parse", message: m }))];
  const seenSerial = new Map<string, number>(), seenDesc = new Map<string, string>();
  for (const l of b.lines) {
    const at = `${l.serial}${l.siteCode ? ` (${l.siteCode})` : ""}`;
    if (l.quantity == null) f.push({ severity: "error", code: "not_measured", line: l.serial, message: `Line ${at} "${l.description}" has no quantity. It is not measured.` });
    else if (l.quantity <= 0) f.push({ severity: "error", code: "bad_quantity", line: l.serial, message: `Line ${at} has a quantity of ${l.quantity}. A quantity must be more than zero.` });
    if (!l.unit) f.push({ severity: "error", code: "no_unit", line: l.serial, message: `Line ${at} has no unit.` });
    else if (!KNOWN_UNITS.has(l.unit.toUpperCase().replace(/[^A-Z]/g, ""))) f.push({ severity: "warn", code: "unknown_unit", line: l.serial, message: `Line ${at} uses the unit "${l.unit}". Please confirm it.` });
    // Parts must add up to the total on the same line.
    const parts = l.parts.map(p => p.value).filter((v): v is number => v != null);
    if (l.quantity != null && parts.length && l.parts.every(p => p.value != null) && !close(parts.reduce((s, v) => s + v, 0), l.quantity, 0.005))
      f.push({ severity: "error", code: "parts_total", line: l.serial, message: `Line ${at}: the parts add up to ${round(parts.reduce((s, v) => s + v, 0))} but the total is ${round(l.quantity)}.` });
    // Square metres and square feet on one line must agree.
    if (l.quantity != null && l.totalSft != null && /^SQM$/i.test(l.unit ?? "") && !close(l.quantity * SQM_TO_SFT, l.totalSft, 0.01))
      f.push({ severity: "error", code: "unit_conversion", line: l.serial, message: `Line ${at}: ${round(l.quantity)} sqm is ${round(l.quantity * SQM_TO_SFT)} sqft, but the sheet shows ${round(l.totalSft)} sqft.` });
    if (seenSerial.has(l.serial)) f.push({ severity: "error", code: "duplicate_serial", line: l.serial, message: `Serial ${l.serial} is used twice (rows ${seenSerial.get(l.serial)} and ${l.row}).` });
    seenSerial.set(l.serial, l.row);
    const key = l.description.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (seenDesc.has(key)) f.push({ severity: "warn", code: "duplicate_description", line: l.serial, message: `Line ${l.serial} has the same description as line ${seenDesc.get(key)}.` });
    seenDesc.set(key, l.serial);
  }
  // The grand total must equal the sum of the lines of one unit. The unit cell of a total row often holds its label,
  // so we try each unit group and accept the total if any group adds up to it.
  if (b.grandTotal?.value != null) {
    const byUnit = new Map<string, number>();
    for (const l of b.lines) if (l.quantity != null) byUnit.set((l.unit ?? "").toUpperCase(), (byUnit.get((l.unit ?? "").toUpperCase()) ?? 0) + l.quantity);
    const total = b.grandTotal.value;
    if (byUnit.size && ![...byUnit.values()].some(sum => close(sum, total, 0.005)))
      f.push({ severity: "error", code: "grand_total", message: `The grand total is ${round(total)}. No group of lines with one unit adds up to it (${[...byUnit].map(([u, v]) => `${u}: ${round(v)}`).join(", ")}).` });
  }
  if (requirementText.trim()) {
    const t = requirementText;
    const hasDate = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(t);
    if (!hasDate) f.push({ severity: "warn", code: "no_dates", message: "The requirement does not give a start date or a completion date." });
    if (!/\b(scope|including|include|covering|cover|toilet|floor|tower|block|area)\b/i.test(t)) f.push({ severity: "warn", code: "no_scope", message: "The requirement does not describe the scope of work." });
  }
  return f;
}
const round = (n: number) => Math.round(n * 100) / 100;

/** A plain clarification for site. One finding per bullet. */
export function clarificationDraft(title: string, findings: Finding[]): { subject: string; body: string } | null {
  const ask = findings.filter(x => x.severity !== "info");
  if (!ask.length) return null;
  const lines = ask.map(x => `- ${x.message}`);
  return {
    subject: `Clarification needed: ${title}`,
    body: ["Dear Sir,", "", `We checked the BOQ for ${title}. Please help us with the points below. We need your reply before we float the tender.`, "", ...lines, "",
      "Please send the corrected sheet or reply with the missing values.", "", "Thanks & Regards,"].join("\n"),
  };
}
