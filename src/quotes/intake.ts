/**
 * W5 quote intake, as plain functions over the database. The Inngest function in
 * src/workflows/b/w5-quote-intake.ts runs them as durable steps; /dev/quotes can run
 * them directly when no Inngest dev server is up.
 *
 *   start  -> a quotes row in status 'extracting' (the UI shows "reading")
 *   read   -> the model's reading (Claude, or the hand-checked fixture in dev)
 *   save   -> normalise in code, write lines, terms and evidence, set 'ready' or 'needs_review'
 */
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import type { EventMap } from "@/contracts/events";
import { documentBytes, getDocument } from "./source";
import { readQuotePdf, type ReadResult } from "./reader";
import { normaliseQuote, type BoqLineIn, type NormalisedQuote } from "./normalise";
import { termsFromRfq, type TermKey } from "./terms";
import { HEADER_FIELDS, type ExtractedQuote } from "./schema";
import { fixtureByFilename, fixtureExtraction, fixtureSecondRead, type FixtureVendor } from "./fixture-quotes";
import { READ_PROMPT_VERSION } from "./prompts";
import { publish } from "@/workflows/b/publish";
import { applyConfirmations, confirmedKeys, type Confirmations } from "./confirmations";

export type IntakeInput = EventMap["quote.received"];
const WF = "W5 quote intake";

export interface IntakeContext {
  vendorName: string | null;
  boq: BoqLineIn[];
  boqVersionId: string | null;
  terms: Record<TermKey, { label: string; text: string }>;
  rfqSentAt: string | null;
  filename: string | null;
}

/** BOQ to compare against: the accepted version for the case, else the latest. */
async function loadBoq(caseId: string): Promise<{ id: string | null; lines: BoqLineIn[] }> {
  const db = admin();
  const { data: versions } = await db.from("boq_versions").select("id,version,status").eq("case_id", caseId).order("version", { ascending: false });
  const v = versions?.find((x: any) => x.status === "accepted") ?? versions?.[0];
  if (!v) return { id: null, lines: [] };
  const { data: lines } = await db.from("boq_lines").select("id,serial,description,unit,quantity").eq("boq_version_id", v.id);
  const sorted = (lines ?? []).sort((a: any, b: any) => String(a.serial).localeCompare(String(b.serial), undefined, { numeric: true }));
  return { id: v.id, lines: sorted.map((l: any) => ({ id: l.id, serial: String(l.serial ?? ""), description: l.description, unit: l.unit, quantity: l.quantity == null ? null : Number(l.quantity) })) };
}

export async function loadContext(input: IntakeInput): Promise<IntakeContext> {
  const db = admin();
  const [doc, vendor, rfq, recipient, boq] = await Promise.all([
    getDocument(input.document_id),
    db.from("vendors").select("name").eq("id", input.vendor_id).single(),
    db.from("rfqs").select("terms,created_at").eq("id", input.rfq_id).maybeSingle(),
    db.from("rfq_recipients").select("sent_at").eq("rfq_id", input.rfq_id).eq("vendor_id", input.vendor_id).maybeSingle(),
    loadBoq(input.case_id),
  ]);
  let rfqSentAt: string | null = recipient.data?.sent_at ?? null;
  if (!rfqSentAt) {
    const { data: anySent } = await db.from("rfq_recipients").select("sent_at").eq("rfq_id", input.rfq_id).not("sent_at", "is", null).order("sent_at").limit(1);
    rfqSentAt = anySent?.[0]?.sent_at ?? null;
  }
  return {
    vendorName: vendor.data?.name ?? null,
    boq: boq.lines,
    boqVersionId: boq.id,
    terms: termsFromRfq(rfq.data?.terms),
    rfqSentAt,
    filename: doc.filename,
  };
}

/**
 * Creates the quotes row for this document (status 'extracting'), or returns the existing
 * one if this document was already read. A second document from the same vendor on the
 * same case is a revision: the next version.
 */
export async function startQuote(input: IntakeInput, opts: { force?: boolean } = {}): Promise<{ quoteId: string; alreadyDone: boolean }> {
  const db = admin();
  const { data: existing } = await db.from("quotes").select("id,status").eq("case_id", input.case_id).eq("vendor_id", input.vendor_id).eq("document_id", input.document_id).order("version", { ascending: false }).limit(1);
  const prev = existing?.[0];
  if (prev && !opts.force && prev.status !== "failed") return { quoteId: prev.id, alreadyDone: prev.status !== "extracting" };
  if (prev && (opts.force || prev.status === "failed")) {
    await db.from("quotes").update({ status: "extracting", error: null, updated_at: new Date().toISOString() }).eq("id", prev.id);
    return { quoteId: prev.id, alreadyDone: false };
  }
  const { data: versions } = await db.from("quotes").select("version").eq("case_id", input.case_id).eq("vendor_id", input.vendor_id).order("version", { ascending: false }).limit(1);
  const version = (versions?.[0]?.version ?? 0) + 1;
  const { data, error } = await db.from("quotes").insert({
    case_id: input.case_id, rfq_id: input.rfq_id, vendor_id: input.vendor_id, document_id: input.document_id, version, status: "extracting",
  }).select("id").single();
  if (error) throw error;
  await logStep({ caseId: input.case_id, workflow: WF, step: `Quote received (version ${version})`, input, output: { quote_id: data.id } });
  return { quoteId: data.id, alreadyDone: false };
}

/** Reads the PDF. QUOTE_READER=fixture (dev only) returns the hand-checked reading instead of calling the model. */
export async function readQuote(input: IntakeInput, ctx: IntakeContext): Promise<ReadResult & { source: "model" | "fixture" }> {
  if (process.env.QUOTE_READER === "fixture" && process.env.NODE_ENV !== "production") {
    const fx = fixtureByFilename(ctx.filename);
    if (!fx) throw new Error(`QUOTE_READER=fixture but no fixture matches ${ctx.filename}`);
    const key = fx.vendor_key as FixtureVendor;
    return { extracted: fixtureExtraction(key), secondRead: fx.scanned ? fixtureSecondRead(key) : null, calls: [], source: "fixture" };
  }
  const pdf = await documentBytes(await getDocument(input.document_id));
  return { ...(await readQuotePdf(pdf, { boq: ctx.boq, terms: ctx.terms, vendorHint: ctx.vendorName })), source: "model" };
}

const HEADER_COLUMNS: Partial<Record<(typeof HEADER_FIELDS)[number], string>> = {
  reference: "reference", validity: "validity", gst_treatment: "gst_treatment", freight: "freight", payment_terms: "payment_terms",
  advance: "advance", completion_time: "completion_time", warranty: "warranty", gstin: "gstin", security_deposit: "security_deposit",
  pf_esi: "pf_esi", mobilisation: "mobilisation", exclusions: "exclusions",
};

/** Normalises in code and writes everything; returns the event payload for quote.extracted. */
export async function saveQuote(
  input: IntakeInput, quoteId: string, ctx: IntakeContext, read: ReadResult & { source: string }, confirmations: Confirmations = {},
): Promise<EventMap["quote.extracted"] & { normalised: NormalisedQuote }> {
  const db = admin();
  const raw: ExtractedQuote = read.extracted;
  const x = applyConfirmations(raw, confirmations);
  const n = normaliseQuote(x, { boq: ctx.boq, rfqSentAt: ctx.rfqSentAt, secondRead: read.secondRead, confirmed: confirmedKeys(confirmations) });

  // Replace any rows from an earlier attempt at this same quote (re-read).
  const { data: oldLines } = await db.from("quote_lines").select("id").eq("quote_id", quoteId);
  const { data: oldTerms } = await db.from("quote_terms").select("id").eq("quote_id", quoteId);
  const oldIds = [quoteId, ...(oldLines ?? []).map((r: any) => r.id), ...(oldTerms ?? []).map((r: any) => r.id)];
  await db.from("extracted_fields").delete().in("entity_id", oldIds).in("entity_type", ["quote", "quote_line", "quote_term"]);
  await db.from("quote_lines").delete().eq("quote_id", quoteId);
  await db.from("quote_terms").delete().eq("quote_id", quoteId);

  const header: Record<string, unknown> = {};
  for (const [f, col] of Object.entries(HEADER_COLUMNS)) header[col!] = x.header[f as keyof typeof x.header].value;
  const { error: qErr } = await db.from("quotes").update({
    ...header,
    quote_date: n.quote_date, validity_days: n.validity_days, valid_until: n.valid_until, gst_rate: n.gst.rate,
    vendor_total: n.vendor_total, stated_total: n.stated_grand_total, total_on_boq: n.total_on_boq, comparable_lines: n.comparable_lines,
    scope: n.scope, flags: n.flags, needs_review: n.needs_review, review_reasons: n.review_reasons,
    conditions: x.vendor_conditions, extraction: raw, second_read: read.secondRead,
    model: read.calls[0]?.model ?? read.source, prompt_version: READ_PROMPT_VERSION,
    status: n.needs_review ? "needs_review" : "ready", error: null, updated_at: new Date().toISOString(),
  }).eq("id", quoteId);
  if (qErr) throw qErr;

  const { data: lineRows, error: lErr } = await db.from("quote_lines").insert(n.lines.map((l, i) => ({
    quote_id: quoteId, position: i, boq_line_id: l.boq_line_id, serial: l.serial, item: l.item, unit_raw: l.unit_raw, unit: l.unit,
    quantity: l.quantity, rate: l.rate, amount: l.amount_stated ?? l.amount_computed, amount_stated: l.amount_stated, amount_computed: l.amount_computed,
    make: l.make, normalized_rate: l.normalized_rate, normalized_unit: l.normalized_unit, boq_unit: l.boq_unit, boq_quantity: l.boq_quantity, amount_on_boq: l.amount_on_boq,
    qty_ratio: l.qty_ratio, rate_handwritten: l.rate_handwritten, page: l.page, confidence: l.confidence, flags: l.flags,
  }))).select("id,position");
  if (lErr) throw lErr;
  const { data: termRows, error: tErr } = await db.from("quote_terms").insert(n.terms.map((t) => ({ quote_id: quoteId, term: t.term, status: t.status, detail: t.detail }))).select("id,term");
  if (tErr) throw tErr;

  // Evidence: one row per value, with the page and snippet it came from.
  const doc = input.document_id;
  const fields: Record<string, unknown>[] = [];
  const who = (key: string) => (confirmations[key] ? { confirmed_by: confirmations[key].by } : {});
  const was = (key: string) => (confirmations[key] ? { read_as: confirmations[key].original } : {});
  for (const f of HEADER_FIELDS) {
    const v = x.header[f];
    if (v.value == null) continue;
    const k = `header:${f}`;
    fields.push({ entity_type: "quote", entity_id: quoteId, field: f, value: { value: v.value, ...was(k) }, document_id: doc, page: v.page, snippet: v.snippet, confidence: v.confidence, ...who(k) });
  }
  for (const row of lineRows ?? []) {
    const l = n.lines[row.position];
    const second = read.secondRead?.rates.find((r) => r.serial.trim() === l.serial.trim());
    const base = { entity_type: "quote_line", entity_id: row.id, document_id: doc, page: l.page, snippet: l.snippet };
    const k = (f: string) => `line:${l.serial.trim()}:${f}`;
    const rateConf = confirmations[k("rate")] ? 1 : l.rate_handwritten ? Math.min(l.confidence, 0.6) : l.confidence;
    fields.push({ ...base, field: "rate", value: { value: l.rate, ...(second ? { second_read: second.rate } : {}), ...was(k("rate")) }, confidence: rateConf, ...who(k("rate")) });
    fields.push({ ...base, field: "quantity", value: { value: l.quantity, ...was(k("quantity")) }, confidence: l.confidence, ...who(k("quantity")) });
    fields.push({ ...base, field: "unit", value: { value: l.unit_raw, ...was(k("unit")) }, confidence: l.confidence, ...who(k("unit")) });
    if (l.amount_stated != null) fields.push({ ...base, field: "amount", value: { value: l.amount_stated }, confidence: l.confidence });
  }
  for (const row of termRows ?? []) {
    const t = n.terms.find((t) => t.term === row.term)!;
    fields.push({ entity_type: "quote_term", entity_id: row.id, field: "status", value: { value: t.status, detail: t.detail }, document_id: doc, page: t.page, snippet: t.snippet, confidence: null });
  }
  if (fields.length) {
    const { error: fErr } = await db.from("extracted_fields").insert(fields);
    if (fErr) throw fErr;
  }

  // This version supersedes older ones from the same vendor on this case (never newer ones).
  const { data: self } = await db.from("quotes").select("version").eq("id", quoteId).single();
  await db.from("quotes").update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("case_id", input.case_id).eq("vendor_id", input.vendor_id).lt("version", self?.version ?? 1).in("status", ["ready", "needs_review"]);

  const flagSummary = n.flags.filter((f) => f.severity !== "info").map((f) => f.message);
  await logStep({
    caseId: input.case_id, workflow: WF, step: `Read quote from ${ctx.vendorName ?? "vendor"}`,
    input: { document_id: doc, filename: ctx.filename, boq_lines: ctx.boq.length },
    output: { quote_id: quoteId, lines: n.lines.length, total_on_boq: n.total_on_boq, scope: n.scope, needs_review: n.needs_review, calls: read.calls, reader: read.source },
    model: read.calls.map((c) => c.model).join(", ") || read.source,
    evidence: { document_id: doc, pages: [...new Set(n.lines.map((l) => l.page))] },
    reasoning: [
      `${n.lines.length} lines read; ${n.comparable_lines} of ${n.boq_lines} BOQ lines comparable.`,
      ...flagSummary,
      ...(n.needs_review ? [`Waiting for review: ${n.review_reasons.length} item(s).`] : []),
    ].join(" "),
    status: n.needs_review ? "waiting" : "done",
  });

  return { quote_id: quoteId, case_id: input.case_id, needs_review: n.needs_review, normalised: n };
}

export async function failQuote(input: IntakeInput, quoteId: string, err: unknown) {
  const message = String((err as Error)?.message ?? err);
  await admin().from("quotes").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", quoteId);
  await logStep({ caseId: input.case_id, workflow: WF, step: "Quote reading failed", input, output: { quote_id: quoteId }, reasoning: message, status: "failed" });
}

/** The whole of W5 without Inngest (dev page and scripts). */
export async function runQuoteIntake(input: IntakeInput, opts: { force?: boolean } = {}) {
  const { quoteId, alreadyDone } = await startQuote(input, opts);
  if (alreadyDone) return { quote_id: quoteId, case_id: input.case_id, skipped: true as const };
  try {
    const ctx = await loadContext(input);
    const read = await readQuote(input, ctx);
    const out = await saveQuote(input, quoteId, ctx, read);
    await publish("quote.extracted", { quote_id: out.quote_id, case_id: out.case_id, needs_review: out.needs_review }, { caseId: input.case_id, actor: "W5" });
    return { ...out, skipped: false as const };
  } catch (e) {
    await failQuote(input, quoteId, e);
    throw e;
  }
}

/** Re-normalises a quote from its stored reading and confirmations (after a review action, or a BOQ change). */
export async function resaveQuote(quoteId: string) {
  const { data: q, error } = await admin().from("quotes")
    .select("id,case_id,rfq_id,vendor_id,document_id,extraction,second_read,confirmations,model,needs_review").eq("id", quoteId).single();
  if (error || !q) throw new Error("quote not found");
  const input: IntakeInput = { case_id: q.case_id, rfq_id: q.rfq_id, vendor_id: q.vendor_id, document_id: q.document_id };
  const ctx = await loadContext(input);
  const out = await saveQuote(input, quoteId, ctx, { extracted: q.extraction, secondRead: q.second_read, calls: [], source: q.model ?? "stored" }, q.confirmations ?? {});
  // Review finished: tell W6 and A this quote is now usable.
  if (q.needs_review && !out.needs_review) {
    await publish("quote.extracted", { quote_id: out.quote_id, case_id: out.case_id, needs_review: false }, { caseId: q.case_id, actor: "review" });
  }
  return out;
}
