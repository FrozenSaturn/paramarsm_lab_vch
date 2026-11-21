/**
 * Indexing for search: chunk a document or a message, embed each chunk, and replace its rows in doc_chunks.
 *
 * - B only reads documents, messages, vendors and vendor_contacts (A's tables). B writes doc_chunks only.
 * - A page without a text layer (a scan) falls back to the quote reading in quotes.extraction.
 * - A run that finds the same chunks as before does nothing ("unchanged"), unless `force` is set.
 */
import { admin } from "@/lib/supabase";
import { embed, toPgVector } from "@/lib/embeddings";
import { logStep } from "@/lib/steps";
import { documentBytes, getDocument, type DocumentRow } from "@/quotes/source";
import { chunkPages, type PageChunk } from "./chunk";
import { extractionPassages } from "./extraction-text";
import { detectLanguage } from "./lang";
import { pdfPages, tidyPageText, type PageText } from "./pdf-text";

const WORKFLOW = "Index document";
/** A page with fewer letters than this has no usable text layer. */
const MIN_PAGE_CHARS = 40;

export interface IndexResult {
  status: "indexed" | "unchanged" | "skipped";
  source: "document" | "message";
  id: string;
  chunks: number;
  /** Pages (or sheets) that had text, and pages filled from the quote reading. */
  pages_text?: (number | null)[];
  pages_from_extraction?: (number | null)[];
  reason?: string;
  ms: number;
}

interface ChunkRow {
  document_id: string | null;
  message_id: string | null;
  case_id: string | null;
  vendor_id: string | null;
  page: number | null;
  chunk_index: number;
  content: string;
  content_hash: string;
  source_type: "document" | "message";
  language: string;
  embedding: string;
}

async function safeLog(s: Parameters<typeof logStep>[0]) {
  try {
    await logStep(s);
  } catch (e) {
    console.warn(`[search] could not write agent_steps: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- documents

type Kind = "pdf" | "text" | "sheet" | "other";
type Page = { page: number | null; text: string };

export function documentKind(doc: { mime: string | null; filename: string | null }): Kind {
  const mime = (doc.mime ?? "").toLowerCase();
  const name = (doc.filename ?? "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") || /\.xlsx$/.test(name)) return "sheet";
  if (mime.startsWith("text/") || /\.(txt|csv|md|eml)$/.test(name)) return "text";
  return "other";
}

/** Each worksheet becomes one "page", numbered from 1, with its cells joined by " | ". */
async function sheetPages(bytes: Buffer): Promise<PageText[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const pages: PageText[] = [];
  wb.worksheets.forEach((ws, i) => {
    const lines: string[] = [ws.name];
    ws.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return "";
        if (typeof v === "object" && v !== null && "result" in v) return String((v as { result: unknown }).result ?? "");
        if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text ?? "");
        return String(v);
      });
      const line = cells.filter((c) => c.trim()).join(" | ");
      if (line) lines.push(line);
    });
    pages.push({ page: i + 1, text: lines.join("\n") });
  });
  return pages;
}

interface QuoteOnDocument { id: string; vendor_id: string; extraction: unknown; vendor_name: string | null }

async function quoteOnDocument(documentId: string): Promise<QuoteOnDocument | null> {
  const db = admin();
  const { data } = await db
    .from("quotes")
    .select("id,vendor_id,extraction,version,status")
    .eq("document_id", documentId)
    .neq("status", "superseded")
    .order("version", { ascending: false })
    .limit(1);
  const q = data?.[0];
  if (!q) return null;
  const { data: v } = await db.from("vendors").select("name").eq("id", q.vendor_id).maybeSingle();
  return { id: q.id, vendor_id: q.vendor_id, extraction: q.extraction, vendor_name: v?.name ?? null };
}

/** Text in front of each chunk when it is embedded (not stored), so "which vendor" questions find the letterhead name. */
function embedLabel(doc: DocumentRow & { kind?: string | null }, vendorName: string | null, page: number | null) {
  const what = vendorName ? `Quotation from ${vendorName}` : doc.kind === "tender" ? "Tender and BOQ" : "Document";
  return `${what}. File ${doc.filename ?? doc.id}${page ? `, page ${page}` : ""}.`;
}

/** Compare the new chunks with the stored ones. True when nothing changed. */
async function sameAsStored(filter: { column: "document_id" | "message_id"; id: string }, chunks: PageChunk[], vendorId: string | null) {
  const { data } = await admin()
    .from("doc_chunks")
    .select("chunk_index,content_hash,vendor_id,page,embedding")
    .eq(filter.column, filter.id)
    .order("chunk_index");
  if (!data || data.length !== chunks.length || data.length === 0) return false;
  return data.every(
    (r, i) => r.content_hash === chunks[i].content_hash && r.page === chunks[i].page && r.vendor_id === vendorId && r.embedding != null,
  );
}

async function replaceChunks(filter: { column: "document_id" | "message_id"; id: string }, rows: ChunkRow[]) {
  const db = admin();
  let del = db.from("doc_chunks").delete().eq(filter.column, filter.id);
  if (filter.column === "message_id") del = del.is("document_id", null);
  const { error: delErr } = await del;
  if (delErr) throw new Error(`could not delete old chunks: ${delErr.message}`);
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from("doc_chunks").insert(rows.slice(i, i + 100));
    if (error) throw new Error(`could not insert chunks: ${error.message}`);
  }
}

async function embedChunks(chunks: PageChunk[], label: (page: number | null) => string): Promise<string[]> {
  const vectors = await embed(chunks.map((c) => `${label(c.page)}\n${c.content}`), "passage");
  return vectors.map(toPgVector);
}

export async function indexDocument(documentId: string, opts: { force?: boolean } = {}): Promise<IndexResult> {
  const started = Date.now();
  let caseId: string | undefined;
  try {
    const doc = await getDocument(documentId);
    caseId = doc.case_id ?? undefined;
    const { data: extra } = await admin().from("documents").select("kind,message_id").eq("id", documentId).maybeSingle();
    const docFull = { ...doc, kind: (extra?.kind as string | null) ?? null };
    const docMessageId = (extra?.message_id as string | null) ?? null;
    const kind = documentKind(doc);
    const quote = await quoteOnDocument(documentId);

    let pages: Page[] = [];
    let reason: string | undefined;
    if (kind === "other" && !quote) {
      const res: IndexResult = { status: "skipped", source: "document", id: documentId, chunks: 0, reason: `no text reader for ${doc.mime ?? doc.filename ?? "this file"}`, ms: Date.now() - started };
      await safeLog({ caseId, workflow: WORKFLOW, step: "index document", input: { document_id: documentId }, output: res, status: "skipped" });
      return res;
    }
    if (kind !== "other") {
      const bytes = await documentBytes(doc);
      if (kind === "pdf") pages = await pdfPages(bytes);
      else if (kind === "sheet") pages = await sheetPages(bytes);
      else pages = [{ page: null, text: tidyPageText(bytes.toString("utf8")) }];
    } else {
      reason = `no text reader for ${doc.mime ?? "this file"}; used the quote reading only`;
    }

    const withText = pages.filter((p) => p.text.replace(/\s/g, "").length >= MIN_PAGE_CHARS);
    const empty = new Set(pages.filter((p) => !withText.includes(p)).map((p) => p.page));

    // Fallback: pages without text get the quote reading. For a scan, handwritten rates are also
    // added for every page, because OCR text does not include them.
    let fromExtraction: Page[] = [];
    if (quote?.extraction) {
      const e = quote.extraction as { is_scanned?: boolean };
      if (kind === "other" || pages.length === 0) {
        fromExtraction = extractionPassages(quote.extraction);
      } else {
        if (empty.size) fromExtraction.push(...extractionPassages(quote.extraction, { onlyPages: empty as Set<number> }));
        if (e.is_scanned) {
          const seen = new Set(fromExtraction.map((p) => p.page));
          fromExtraction.push(...extractionPassages(quote.extraction, { linesOnly: true }).filter((p) => !seen.has(p.page)));
        }
      }
    }

    const sources = [...withText, ...fromExtraction].sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity));
    const chunks = chunkPages(sources);
    const vendorId = quote?.vendor_id ?? null;

    if (chunks.length === 0) {
      const res: IndexResult = { status: "skipped", source: "document", id: documentId, chunks: 0, reason: "no text on any page and no quote reading", ms: Date.now() - started };
      await safeLog({ caseId, workflow: WORKFLOW, step: "index document", input: { document_id: documentId }, output: res, status: "skipped" });
      return res;
    }
    if (!opts.force && (await sameAsStored({ column: "document_id", id: documentId }, chunks, vendorId))) {
      const res: IndexResult = { status: "unchanged", source: "document", id: documentId, chunks: chunks.length, ms: Date.now() - started };
      await safeLog({ caseId, workflow: WORKFLOW, step: "index document", input: { document_id: documentId }, output: res });
      return res;
    }

    const vectors = await embedChunks(chunks, (page) => embedLabel(docFull, quote?.vendor_name ?? null, page));
    const rows: ChunkRow[] = chunks.map((c, i) => ({
      document_id: documentId, message_id: docMessageId, case_id: doc.case_id, vendor_id: vendorId,
      page: c.page, chunk_index: c.chunk_index, content: c.content, content_hash: c.content_hash,
      source_type: "document", language: detectLanguage(c.content), embedding: vectors[i],
    }));
    await replaceChunks({ column: "document_id", id: documentId }, rows);

    const res: IndexResult = {
      status: "indexed", source: "document", id: documentId, chunks: rows.length,
      pages_text: withText.map((p) => p.page), pages_from_extraction: fromExtraction.map((p) => p.page), reason, ms: Date.now() - started,
    };
    await safeLog({ caseId, workflow: WORKFLOW, step: "index document", input: { document_id: documentId, filename: doc.filename, quote_id: quote?.id ?? null }, output: res, model: "multilingual-e5-small" });
    return res;
  } catch (e) {
    await safeLog({ caseId, workflow: WORKFLOW, step: "index document", input: { document_id: documentId }, output: { error: (e as Error).message }, status: "failed" });
    throw e;
  }
}

// ---------------------------------------------------------------- messages

/** The email address in a sender such as `Name <a@b.c>`, in lower case, or the sender digits for a phone number. */
export function senderKey(sender: string | null | undefined): { email: string | null; phone: string | null } {
  const s = (sender ?? "").trim();
  const email = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase() ?? null;
  const digits = email ? null : s.replace(/\D/g, "");
  return { email, phone: digits && digits.length >= 8 ? digits : null };
}

async function vendorForSender(sender: string | null): Promise<string | null> {
  const { email, phone } = senderKey(sender);
  const db = admin();
  if (email) {
    const { data } = await db.from("vendor_contacts").select("vendor_id").ilike("email", email).limit(1);
    if (data?.[0]) return data[0].vendor_id;
  }
  if (phone) {
    const { data } = await db.from("vendor_contacts").select("vendor_id,phone").not("phone", "is", null);
    const last10 = phone.slice(-10);
    const hit = (data ?? []).find((c) => String(c.phone).replace(/\D/g, "").endsWith(last10));
    if (hit) return hit.vendor_id;
  }
  return null;
}

export async function indexMessage(messageId: string, opts: { force?: boolean } = {}): Promise<IndexResult> {
  const started = Date.now();
  let caseId: string | undefined;
  try {
    const { data: m, error } = await admin()
      .from("messages")
      .select("id,case_id,channel,sender,subject,body,body_en")
      .eq("id", messageId)
      .single();
    if (error || !m) throw new Error(`message ${messageId} not found: ${error?.message ?? ""}`);
    caseId = m.case_id ?? undefined;

    const body = [m.subject, m.body].filter((x) => x && String(x).trim()).join("\n\n");
    const texts: { page: number | null; text: string }[] = [];
    if (body.trim()) texts.push({ page: null, text: body });
    if (m.body_en && m.body_en.trim() && m.body_en.trim() !== (m.body ?? "").trim()) texts.push({ page: null, text: m.body_en });
    const chunks = chunkPages(texts);
    if (chunks.length === 0) {
      const res: IndexResult = { status: "skipped", source: "message", id: messageId, chunks: 0, reason: "message has no text", ms: Date.now() - started };
      await safeLog({ caseId, workflow: WORKFLOW, step: "index message", input: { message_id: messageId }, output: res, status: "skipped" });
      return res;
    }
    const vendorId = await vendorForSender(m.sender);
    if (!opts.force && (await sameAsStored({ column: "message_id", id: messageId }, chunks, vendorId))) {
      const res: IndexResult = { status: "unchanged", source: "message", id: messageId, chunks: chunks.length, ms: Date.now() - started };
      await safeLog({ caseId, workflow: WORKFLOW, step: "index message", input: { message_id: messageId }, output: res });
      return res;
    }
    const label = `${m.channel ?? "Message"} message${m.subject ? `: ${m.subject}` : ""}.`;
    const vectors = await embedChunks(chunks, () => label);
    const rows: ChunkRow[] = chunks.map((c, i) => ({
      document_id: null, message_id: messageId, case_id: m.case_id, vendor_id: vendorId, page: null,
      chunk_index: c.chunk_index, content: c.content, content_hash: c.content_hash,
      source_type: "message", language: detectLanguage(c.content), embedding: vectors[i],
    }));
    await replaceChunks({ column: "message_id", id: messageId }, rows);
    const res: IndexResult = { status: "indexed", source: "message", id: messageId, chunks: rows.length, ms: Date.now() - started };
    await safeLog({ caseId, workflow: WORKFLOW, step: "index message", input: { message_id: messageId }, output: res, model: "multilingual-e5-small" });
    return res;
  } catch (e) {
    await safeLog({ caseId, workflow: WORKFLOW, step: "index message", input: { message_id: messageId }, output: { error: (e as Error).message }, status: "failed" });
    throw e;
  }
}
