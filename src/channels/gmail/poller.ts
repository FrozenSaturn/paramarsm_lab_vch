import { createHash } from "node:crypto";
import { simpleParser, type ParsedMail } from "mailparser";
import { admin } from "../../lib/supabase";
import { emit } from "../../lib/steps";
import { gmailFor } from "./client";
import { splitQuoted } from "./quoted";
import { dmarcPassDomain, mailboxKey, parseAddr } from "./auth-results";
import { senderAllowed } from "./allow";

const BUCKET = process.env.STORAGE_BUCKET || "documents";
const QUOTE_TYPES = /pdf|spreadsheet|excel|csv|image\//i;

/** Poll one mailbox. First run sets a baseline at "now": old mail is not imported. */
export async function pollMailbox(userId: string) {
  const db = admin();
  const gmail = await gmailFor(userId);
  const { data: tok } = await db.from("mail_tokens").select("history_id").eq("user_id", userId).single();

  if (!tok?.history_id) {
    const { data } = await gmail.users.getProfile({ userId: "me" });
    await db.from("mail_tokens").update({ history_id: data.historyId, updated_at: new Date().toISOString() }).eq("user_id", userId);
    return { baseline: data.historyId, imported: 0 };
  }

  const ids = new Set<string>();
  let newest = tok.history_id as string;
  let pageToken: string | undefined;
  try {
    do {
      const { data } = await gmail.users.history.list({ userId: "me", startHistoryId: tok.history_id, historyTypes: ["messageAdded"], labelId: "INBOX", pageToken });
      for (const h of data.history ?? []) for (const m of h.messagesAdded ?? []) if (m.message?.id) ids.add(m.message.id);
      if (data.historyId) newest = data.historyId;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (e: any) {
    // Gmail keeps history for about a week. If our id is too old, start again from now.
    if (e?.code === 404) {
      const { data } = await gmail.users.getProfile({ userId: "me" });
      await db.from("mail_tokens").update({ history_id: data.historyId }).eq("user_id", userId);
      return { baseline: data.historyId, imported: 0, reset: true };
    }
    throw e;
  }

  let imported = 0;
  for (const id of ids) {
    try { if (await importMessage(userId, id)) imported++; }
    catch (e: any) {
      // One bad message must not block the rest. The failure is logged. Its import can be run again by Gmail id.
      await db.from("agent_steps").insert({ workflow: "gmail-poll", step: `import failed: ${id}`, status: "failed", output: { gmail_id: id, error: String(e?.message ?? e) }, finished_at: new Date().toISOString() });
    }
  }
  // Move the pointer only after every message in this batch was handled.
  await db.from("mail_tokens").update({ history_id: newest, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return { imported, historyId: newest };
}

async function importMessage(userId: string, gmailId: string): Promise<boolean> {
  const db = admin();
  const { data: seen } = await db.from("messages").select("id").eq("external_id", gmailId).maybeSingle();
  if (seen) return false; // already stored (for example, a mail we sent to ourselves)

  const gmail = await gmailFor(userId);
  const { data: raw } = await gmail.users.messages.get({ userId: "me", id: gmailId, format: "raw" });
  const { data: meta } = await gmail.users.messages.get({ userId: "me", id: gmailId, format: "minimal" });
  if (!raw.raw) return false;
  return ingestRaw({ gmailId, threadId: meta.threadId ?? null, eml: Buffer.from(raw.raw, "base64url") });
}

/** Store and parse one raw mail. No Gmail calls here, so tests can feed any .eml. */
export async function ingestRaw({ gmailId, threadId, eml }: { gmailId: string; threadId: string | null; eml: Buffer }): Promise<boolean> {
  const db = admin();
  const mail = await simpleParser(eml);
  // Mail from other senders is not stored at all. A mailbox can hold personal mail, and stored text goes to triage and search.
  if (!(await senderAllowed(addr(mail.from)[0] ?? null))) return false;
  // Store the raw mail first, then use it.
  const rawPath = `mail/${gmailId}.eml`;
  const up = await db.storage.from(BUCKET).upload(rawPath, eml, { contentType: "message/rfc822", upsert: true });
  if (up.error) throw new Error(`could not store raw mail: ${up.error.message}`);

  const subject = mail.subject ?? "";
  const from = addr(mail.from)[0] ?? null;
  const recipients = [...addr(mail.to), ...addr(mail.cc)];
  const text = mail.text ?? htmlToText(mail.html || "");
  const { latest, quoted } = splitQuoted(text);

  const match = await matchRfq(mail, threadId, subject, from);

  const { data: msg, error } = await db.from("messages").insert({
    case_id: match?.caseId ?? null, channel: "email", direction: "in", external_id: gmailId, thread_id: threadId,
    sender: from, recipients, subject, body: latest, raw_path: rawPath, sender_verified: senderAuthenticated(mail),
    classification: match ? "vendor_reply" : (/\[VIN-RFQ-\d+\]/i.test(subject) ? "unverified_reply" : null), // rule-based until triage (W0) classifies with a model. An RFQ token without a passed sender check needs a person.
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return false; // another poll run stored it first
    throw error;
  }
  // The quoted part is context, not the message. Keep it in the raw mail; chunks use the latest text.
  void quoted;

  // A message row means "seen". So if any attachment fails, remove the row: the next poll then starts clean.
  // Events go out only after everything is stored.
  const opts = { caseId: match?.caseId, actor: "gmail-poller" };
  const events: (() => Promise<void>)[] = [() => emit("message.stored", { message_id: msg.id, case_id: match?.caseId }, opts)];
  // Triage (W0) reads every inbound message that no RFQ reply rule has already claimed.
  if (!match) events.push(() => emit("message.received", { message_id: msg.id }, opts));
  try {
    for (const a of mail.attachments) {
      if (a.contentDisposition === "inline" && !a.filename) continue; // signature images
      const sha = createHash("sha256").update(a.content).digest("hex");
      const path = `mail/${gmailId}/${sha.slice(0, 12)}-${safeName(a.filename ?? "attachment")}`;
      const put = await db.storage.from(BUCKET).upload(path, a.content, { contentType: a.contentType, upsert: true });
      if (put.error) throw new Error(`could not store attachment: ${put.error.message}`);
      const { data: doc, error: de } = await db.from("documents").insert({
        case_id: match?.caseId ?? null, message_id: msg.id, filename: a.filename ?? "attachment", mime: a.contentType, storage_path: path, sha256: sha,
        kind: match && QUOTE_TYPES.test(a.contentType) ? "quote" : null,
      }).select("id").single();
      if (de) { if (de.code === "23505") continue; throw de; } // same file already stored for this case
      events.push(() => emit("document.stored", { document_id: doc.id, message_id: msg.id }, opts));
      // B reads quotes from this event. Needs a known RFQ and vendor.
      if (match?.vendorId && match.rfqId && QUOTE_TYPES.test(a.contentType))
        events.push(() => emit("quote.received", { case_id: match.caseId, rfq_id: match.rfqId, vendor_id: match.vendorId!, document_id: doc.id }, opts));
    }
  } catch (e) {
    await db.from("documents").delete().eq("message_id", msg.id);
    await db.from("messages").delete().eq("id", msg.id);
    throw e;
  }
  for (const send of events) await send();
  return true;
}

/** Gmail adds an Authentication-Results header with its own server name on top. A sender can add a
 *  fake one lower in the mail, so we read only the first entry and it must name Gmail's server.
 *  DMARC must pass for the same domain as the From address, and the mail must have exactly one From address. */
export function senderAuthenticated(mail: ParsedMail): boolean {
  const froms = mail.from?.value ?? [];
  if (froms.length !== 1 || !froms[0].address) return false;
  const from = parseAddr(froms[0].address);
  if (!from) return false;
  const h = mail.headers.get("authentication-results");
  const list = (Array.isArray(h) ? h : h ? [h] : []).map(x => (typeof x === "string" ? x : (x as any).value ?? String(x)));
  if (!list.length) return false;
  return dmarcPassDomain(list[0]) === from.domain;
}

const baseAddr = mailboxKey;

/** Link a reply to its RFQ: first by Gmail thread, then by the [VIN-RFQ-####] token in the subject.
 *  A From header is not proof of who sent the mail. We attribute a reply (case, RFQ, vendor) only when
 *  Gmail's own check says DMARC passed. Otherwise the mail stays unmatched for a person to review. */
async function matchRfq(mail: ParsedMail, threadId: string | null, subject: string, from: string | null) {
  if (!from || !senderAuthenticated(mail)) return null;
  const db = admin();
  const recipientsOf = async (rfqId: string) =>
    ((await db.from("rfq_recipients").select("vendor_id, email").eq("rfq_id", rfqId)).data ?? []) as { vendor_id: string; email: string | null }[];
  // The vendor must be a recipient of this RFQ, and the sender must be that recipient's mailbox.
  const vendorFor = (rows: { vendor_id: string; email: string | null }[]) => {
    const me = baseAddr(from);
    const hits = me ? rows.filter(r => r.email && baseAddr(r.email) === me) : [];
    return new Set(hits.map(h => h.vendor_id)).size === 1 ? hits[0].vendor_id : null; // several vendors share one mailbox: ambiguous
  };

  if (threadId) {
    const { data } = await db.from("rfq_recipients").select("rfq_id, vendor_id, email, rfqs!inner(case_id)").eq("gmail_thread_id", threadId).limit(1).maybeSingle();
    if (data) {
      // A thread we started names the vendor, so shared mailboxes are not ambiguous here.
      // The sender must still be that recipient. Another sender in the thread stays unmatched.
      const me = baseAddr(from);
      if (!me || !data.email || baseAddr(data.email) !== me) return null;
      return { rfqId: data.rfq_id as string, vendorId: data.vendor_id as string, caseId: (data as any).rfqs.case_id as string };
    }
  }
  const token = subject.match(/\[VIN-(RFQ-\d+)\]/i);
  if (token) {
    const { data: rfq } = await db.from("rfqs").select("id, case_id").eq("ref", token[1].toUpperCase()).maybeSingle();
    if (rfq) {
      const rows = await recipientsOf(rfq.id);
      // A subject token alone proves nothing. The sender must be a recipient of this RFQ.
      const me = baseAddr(from);
      if (!me || !rows.some(r => r.email && baseAddr(r.email) === me)) return null;
      return { rfqId: rfq.id as string, vendorId: vendorFor(rows), caseId: rfq.case_id as string };
    }
  }
  return null;
}

const addr = (a: ParsedMail["from"] | ParsedMail["to"] | ParsedMail["cc"]): string[] => {
  if (!a) return [];
  const list = Array.isArray(a) ? a : [a];
  return list.flatMap(x => x.value.map(v => (v.address ?? "").toLowerCase()).filter(Boolean));
};
const htmlToText = (h: string | false) => (h || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
