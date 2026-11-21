/**
 * Loads the comparative inputs from the database (server only). Reads only: it never
 * writes. The matrix and the scores are built from what this returns, so the same rows
 * always give the same numbers.
 */
import { admin } from "@/lib/supabase";
import type { Flag } from "@/quotes/normalise";
import { TERM_KEYS, type TermKey, type TermStatus } from "@/quotes/terms";
import { weightsForCategory, type FactsExtra } from "@/scoring";
import type { PerformanceRecord, Weights } from "@/scoring/types";
import { gstFraction } from "./matrix";
import type { CompareBoqLine, CompareInput, CompareQuote, CompareQuoteLine } from "./types";

/** Quote statuses that go into a comparison. `extracting`, `failed` and `superseded` stay out. */
export const LIVE_STATUSES = ["ready", "needs_review"] as const;

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bySerial = (a: { serial: string }, b: { serial: string }) => a.serial.localeCompare(b.serial, "en", { numeric: true });

/**
 * GST treatment from the flags W5 set when it read the GST text. W5 stores the printed GST
 * text in `quotes.gst_treatment`, and writes `gst_not_stated` or `gst_inclusive` when it applies.
 */
export function gstTreatmentFrom(flags: Flag[], text: string | null): CompareQuote["gst_treatment"] {
  if (flags.some((f) => f.code === "gst_inclusive")) return "inclusive";
  if (flags.some((f) => f.code === "gst_not_stated") || !text?.trim()) return "not_stated";
  return "extra";
}

/** Newest version per vendor among the live quotes. */
export function newestPerVendor<T extends { vendor_id: string; version: number | null }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const cur = best.get(r.vendor_id);
    if (!cur || (r.version ?? 1) > (cur.version ?? 1)) best.set(r.vendor_id, r);
  }
  return [...best.values()].sort((a, b) => cmp(a.vendor_id, b.vendor_id));
}

/** The live quotes on a case: newest version per vendor, status `ready` or `needs_review`. */
export async function liveQuoteRows(caseId: string) {
  const { data, error } = await admin().from("quotes").select("id,vendor_id,rfq_id,version,status")
    .eq("case_id", caseId).in("status", [...LIVE_STATUSES]);
  if (error) throw error;
  return newestPerVendor((data ?? []) as { id: string; vendor_id: string; rfq_id: string | null; version: number | null; status: string }[]);
}

/**
 * The RFQ the comparison is for: the RFQ most of the live quotes answer, else the newest
 * RFQ of the case that went out. Ties go to the lower id, so the choice is stable.
 */
async function pickRfq(caseId: string, quoteRfqIds: (string | null)[]): Promise<{ id: string; due_date: string | null } | null> {
  const db = admin();
  const counts = new Map<string, number>();
  for (const id of quoteRfqIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  const fromQuotes = [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0];
  if (fromQuotes) {
    const { data } = await db.from("rfqs").select("id,due_date").eq("id", fromQuotes).maybeSingle();
    if (data) return data;
  }
  const { data: rfqs } = await db.from("rfqs").select("id,due_date,status,created_at").eq("case_id", caseId).order("created_at", { ascending: false });
  if (!rfqs?.length) return null;
  const { data: sent } = await db.from("rfq_recipients").select("rfq_id").in("rfq_id", rfqs.map((r: any) => r.id)).not("sent_at", "is", null);
  const sentIds = new Set((sent ?? []).map((r: any) => r.rfq_id));
  const r = rfqs.find((x: any) => sentIds.has(x.id)) ?? rfqs.find((x: any) => x.status === "sent") ?? rfqs[0];
  return { id: r.id, due_date: r.due_date };
}

/**
 * The BOQ version the quotes were normalised against: the version most of the quote lines
 * point to, else the accepted version, else the latest. Rows keep the BOQ's own unit and
 * quantity (SQFT, RMT): the matrix converts each vendor rate into that unit, so the
 * amounts equal rate × Vinayak's quantity exactly.
 */
async function pickBoq(caseId: string, referencedLineIds: string[]) {
  const db = admin();
  const { data: versions } = await db.from("boq_versions").select("id,version,status").eq("case_id", caseId).order("version", { ascending: false });
  if (!versions?.length) return { id: null, rows: [] as CompareBoqLine[], serialById: new Map<string, string>() };
  const { data: allLines } = await db.from("boq_lines").select("id,boq_version_id,serial,description,unit,quantity").in("boq_version_id", versions.map((v: any) => v.id));
  const lines = (allLines ?? []) as { id: string; boq_version_id: string; serial: string | null; description: string; unit: string | null; quantity: unknown }[];
  const versionOf = new Map(lines.map((l) => [l.id, l.boq_version_id]));
  const refs = new Map<string, number>();
  for (const id of referencedLineIds) {
    const v = versionOf.get(id);
    if (v) refs.set(v, (refs.get(v) ?? 0) + 1);
  }
  const rank = (id: string) => versions.findIndex((v: any) => v.id === id); // 0 = newest
  const byRefs = [...refs.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]?.[0];
  const chosen = byRefs ?? versions.find((v: any) => v.status === "accepted")?.id ?? versions[0].id;
  const rows: CompareBoqLine[] = lines
    .filter((l) => l.boq_version_id === chosen)
    .map((l) => ({ id: l.id, serial: String(l.serial ?? ""), description: l.description, unit: l.unit, quantity: num(l.quantity) }))
    .sort(bySerial);
  return { id: chosen as string, rows, serialById: new Map(lines.map((l) => [l.id, String(l.serial ?? "")])) };
}

/** When each quote reached us: the message time, else the document time, else the quotes row time. */
async function receivedTimes(quotes: { id: string; document_id: string | null; created_at: string | null }[]) {
  const db = admin();
  const docIds = quotes.map((q) => q.document_id).filter((x): x is string => !!x);
  const { data: docs } = docIds.length ? await db.from("documents").select("id,message_id,created_at").in("id", docIds) : { data: [] };
  const msgIds = (docs ?? []).map((d: any) => d.message_id).filter(Boolean);
  const { data: msgs } = msgIds.length ? await db.from("messages").select("id,created_at").in("id", msgIds) : { data: [] };
  const out = new Map<string, string | null>();
  for (const q of quotes) {
    const d = (docs ?? []).find((x: any) => x.id === q.document_id);
    const m = d?.message_id ? (msgs ?? []).find((x: any) => x.id === d.message_id) : null;
    out.set(q.id, m?.created_at ?? d?.created_at ?? q.created_at ?? null);
  }
  return out;
}

/**
 * Builds the CompareInput for a case from the database: the live quotes (newest version per
 * vendor), their lines and terms, the BOQ they answer, and the RFQ times.
 */
export async function loadCompareInput(caseId: string): Promise<CompareInput> {
  const db = admin();
  const live = await liveQuoteRows(caseId);
  const ids = live.map((q) => q.id);
  const [{ data: quotes, error: qErr }, { data: lineRows, error: lErr }, { data: termRows, error: tErr }] = ids.length
    ? await Promise.all([
        db.from("quotes").select("id,vendor_id,rfq_id,version,status,document_id,quote_date,scope,gst_treatment,gst_rate,validity_days,valid_until,payment_terms,advance,completion_time,mobilisation,warranty,needs_review,flags,confirmations,created_at").in("id", ids),
        db.from("quote_lines").select("id,quote_id,boq_line_id,serial,item,unit_raw,quantity,rate,normalized_rate,normalized_unit,make,page,rate_handwritten,flags,position").in("quote_id", ids).order("position"),
        db.from("quote_terms").select("quote_id,term,status,detail").in("quote_id", ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (qErr) throw qErr;
  if (lErr) throw lErr;
  if (tErr) throw tErr;

  const vendorIds = [...new Set((quotes ?? []).map((q: any) => q.vendor_id as string))];
  const { data: vendors } = vendorIds.length ? await db.from("vendors").select("id,name").in("id", vendorIds) : { data: [] };
  const vendorName = new Map((vendors ?? []).map((v: any) => [v.id as string, v.name as string]));

  const rfq = await pickRfq(caseId, (quotes ?? []).map((q: any) => q.rfq_id));
  let rfqSentAt: string | null = null;
  if (rfq) {
    const { data: sent } = await db.from("rfq_recipients").select("sent_at").eq("rfq_id", rfq.id).not("sent_at", "is", null).order("sent_at").limit(1);
    rfqSentAt = sent?.[0]?.sent_at ?? null;
  }

  const boq = await pickBoq(caseId, (lineRows ?? []).map((l: any) => l.boq_line_id).filter(Boolean));
  const rowIds = new Set(boq.rows.map((r) => r.id));
  const received = await receivedTimes((quotes ?? []) as any[]);

  const out: CompareQuote[] = ((quotes ?? []) as any[]).map((q) => {
    const conf = Object.keys(q.confirmations ?? {});
    const flags = (q.flags ?? []) as Flag[];
    const lines: CompareQuoteLine[] = ((lineRows ?? []) as any[]).filter((l) => l.quote_id === q.id).map((l) => {
      // A line that points into another BOQ version is matched to this version by its serial.
      const inBoq = l.boq_line_id && rowIds.has(l.boq_line_id);
      const boqSerial = l.boq_line_id ? boq.serialById.get(l.boq_line_id) ?? null : null;
      return {
        id: l.id,
        boq_line_id: inBoq ? l.boq_line_id : null,
        boq_serial: boqSerial,
        serial: l.serial,
        item: l.item,
        unit_raw: l.unit_raw,
        quantity: num(l.quantity),
        rate: num(l.rate),
        normalized_rate: num(l.normalized_rate),
        normalized_unit: l.normalized_unit,
        make: l.make,
        page: l.page,
        rate_handwritten: !!l.rate_handwritten,
        rate_confirmed: l.serial != null && conf.includes(`line:${String(l.serial).trim()}:rate`),
        flags: (l.flags ?? []) as Flag[],
      };
    });
    const terms = ((termRows ?? []) as any[])
      .filter((t) => t.quote_id === q.id && (TERM_KEYS as readonly string[]).includes(t.term))
      .map((t) => ({ term: t.term as TermKey, status: t.status as TermStatus, detail: t.detail?.trim() ? t.detail : null }))
      .sort((a, b) => TERM_KEYS.indexOf(a.term) - TERM_KEYS.indexOf(b.term));
    return {
      quote_id: q.id,
      vendor_id: q.vendor_id,
      vendor_name: vendorName.get(q.vendor_id) ?? q.vendor_id,
      version: q.version ?? 1,
      status: q.status,
      document_id: q.document_id,
      quote_date: q.quote_date ? String(q.quote_date).slice(0, 10) : null,
      received_at: received.get(q.id) ?? null,
      scope: q.scope ?? "unknown",
      gst_treatment: gstTreatmentFrom(flags, q.gst_treatment),
      gst_rate: gstFraction(num(q.gst_rate)),
      validity_days: num(q.validity_days),
      valid_until: q.valid_until ? String(q.valid_until).slice(0, 10) : null,
      payment_terms: q.payment_terms,
      advance: q.advance,
      completion_time: q.completion_time,
      mobilisation: q.mobilisation,
      warranty: q.warranty,
      needs_review: !!q.needs_review,
      flags,
      lines,
      terms,
    };
  }).sort((a, b) => cmp(a.vendor_id, b.vendor_id));

  return {
    case_id: caseId,
    rfq_id: rfq?.id ?? null,
    boq_version_id: boq.id,
    rfq_sent_at: rfqSentAt,
    rfq_due_date: rfq?.due_date ? String(rfq.due_date).slice(0, 10) : null,
    boq: boq.rows,
    quotes: out,
  };
}

export interface ScoringExtras {
  extra: FactsExtra;
  weights: Weights;
  /** The `scoring_weights` row the weights came from, or "built-in" when the table has none. */
  category: string;
}

/**
 * The scoring inputs that are not in the matrix: `vendor_performance` rows, reminders sent
 * for this RFQ, the required days (no source yet, so null) and the weights for the category.
 */
export async function loadScoringExtras(caseId: string, vendorIds: string[], rfqId: string | null, category: string | null = null): Promise<ScoringExtras> {
  const db = admin();
  const [{ data: perf, error: pErr }, { data: rec }, { data: weightRows, error: wErr }] = await Promise.all([
    vendorIds.length
      ? db.from("vendor_performance").select("id,vendor_id,quality,timeliness,disputes,safety,is_demo").in("vendor_id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    rfqId && vendorIds.length
      ? db.from("rfq_recipients").select("vendor_id,reminders_sent").eq("rfq_id", rfqId).in("vendor_id", vendorIds)
      : Promise.resolve({ data: [] }),
    db.from("scoring_weights").select("category,weights"),
  ]);
  if (pErr) throw pErr;
  if (wErr) throw wErr;

  const performance: Record<string, PerformanceRecord[]> = {};
  for (const id of vendorIds) performance[id] = [];
  for (const p of ((perf ?? []) as any[]).sort((a, b) => cmp(a.id, b.id))) {
    (performance[p.vendor_id] ??= []).push({
      id: p.id, quality: num(p.quality), timeliness: num(p.timeliness), disputes: num(p.disputes), safety: num(p.safety), is_demo: p.is_demo !== false,
    });
  }
  const reminders: Record<string, number> = {};
  for (const id of vendorIds) reminders[id] = 0;
  for (const r of (rec ?? []) as any[]) reminders[r.vendor_id] = Math.max(reminders[r.vendor_id] ?? 0, num(r.reminders_sent) ?? 0);

  const rows = (weightRows ?? []) as { category: string; weights: unknown }[];
  const want = category?.trim().toLowerCase() || null;
  const row = (want ? rows.find((r) => r.category.trim().toLowerCase() === want) : undefined) ?? rows.find((r) => r.category.trim().toLowerCase() === "default");
  return {
    extra: { performance, reminders, required_days: null },
    weights: weightsForCategory(rows, category),
    category: row?.category ?? "built-in",
  };
}
