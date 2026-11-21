/**
 * Remember message: on message.stored, send the message to the memory layer with its
 * entity scopes, then ask whether it reports a vendor's performance.
 *
 * Confidentiality (PLAN section 6): only demo-written content goes to the mem0 cloud.
 * A message goes there only when its sender is on MEM0_SENDER_ALLOWLIST. An empty list
 * sends nothing. Without MEM0_API_KEY the memory stays in our own memory_refs table, but
 * the allow-list still applies, so the behaviour is the same in both set-ups.
 *
 * The message is read only. B never writes messages.
 */
import { inngest } from "@/workflows/client";
import type { EventMap } from "@/contracts/events";
import { admin } from "@/lib/supabase";
import { logStep } from "@/lib/steps";
import { entity, emailKey, memoryStore, parseAllowlist, phoneKey, senderAllowed, vendorsMentioned } from "@/memory";
import { proposeFromText, type Candidate } from "@/agents/b/performance-from-memory";

const WF = "Remember message";

export interface MessageRow {
  id: string;
  channel?: string | null;
  case_id: string | null;
  sender: string | null;
  subject: string | null;
  body: string | null;
  body_en: string | null;
  direction: string | null;
}

export async function loadMessage(messageId: string): Promise<MessageRow | null> {
  const { data } = await admin().from("messages").select("id,case_id,channel,sender,subject,body,body_en,direction").eq("id", messageId).maybeSingle();
  return (data as MessageRow) ?? null;
}

/** The text we remember: the English body when A has translated it, else the original. */
export const messageText = (m: MessageRow) => [m.subject ? `Subject: ${m.subject}` : "", (m.body_en ?? m.body ?? "").trim()].filter(Boolean).join("\n").trim();

/** Vendors whose contact matches the sender, and vendors that the text names. Read only. */
export async function vendorsForMessage(sender: string | null, text: string): Promise<Candidate[]> {
  const db = admin();
  const out = new Map<string, Candidate>();
  const email = sender ? emailKey(sender) : null;
  const phone = sender ? phoneKey(sender) : null;
  if (email || phone) {
    const { data: contacts } = await db.from("vendor_contacts").select("vendor_id,email,phone").limit(2000);
    const ids = (contacts ?? [])
      .filter((c: any) => (email && c.email && c.email.toLowerCase() === email) || (phone && c.phone && phoneKey(c.phone) === phone))
      .map((c: any) => c.vendor_id as string);
    if (ids.length) {
      const { data: vs } = await db.from("vendors").select("id,name").in("id", [...new Set(ids)]);
      for (const v of vs ?? []) out.set(v.id, v as Candidate);
    }
  }
  const { data: all } = await db.from("vendors").select("id,name").limit(1000);
  for (const v of vendorsMentioned(text, (all ?? []) as Candidate[])) out.set(v.id, v);
  return [...out.values()];
}

export async function rememberMessage(input: EventMap["message.stored"]) {
  const m = await loadMessage(input.message_id);
  if (!m) return { skipped: "message not found" };
  const caseId = input.case_id ?? m.case_id ?? null;
  // A "From" header can be forged, so email senders are not trusted by default. WhatsApp sender ids come from the
  // WhatsApp network. Set MEM0_ALLOW_EMAIL=true only for a demo mailbox that only the builders write to.
  const emailTrusted = process.env.MEM0_ALLOW_EMAIL === "true";
  if ((m.channel === "email" && !emailTrusted) || !senderAllowed(m.sender, parseAllowlist(process.env.MEM0_SENDER_ALLOWLIST))) {
    await logStep({ caseId: caseId ?? undefined, workflow: WF, step: "allow-list", status: "skipped",
      input: { message_id: m.id }, output: { skipped: "sender not on allow-list" } }).catch(() => undefined);
    return { skipped: "sender not on allow-list" };
  }
  const text = messageText(m);
  if (!text) return { skipped: "empty message" };

  let projectId: string | null = null;
  if (caseId) {
    const { data: c } = await admin().from("cases").select("project_id").eq("id", caseId).maybeSingle();
    projectId = c?.project_id ?? null;
  }
  const vendors = await vendorsForMessage(m.sender, text);
  const entities = [
    ...(caseId ? [entity("case", caseId)] : []),
    ...(projectId ? [entity("project", projectId)] : []),
    ...vendors.map((v) => entity("vendor", v.id)),
  ];
  if (!entities.length) return { skipped: "no case, project or vendor for this message" };

  const added = await memoryStore().remember(text, entities, { message_id: m.id });
  await logStep({ caseId: caseId ?? undefined, workflow: WF, step: "remember", input: { message_id: m.id, entities },
    output: { memories: added.memories, pending: added.pending, refs: added.refs.map((r) => r.id) } }).catch(() => undefined);
  const vendorRef = added.refs.find((r) => r.entity.startsWith("vendor:")) ?? added.refs[0];
  return { message_id: m.id, case_id: caseId, entities, vendors, memories: added.memories, pending: added.pending, memory_ref_id: vendorRef?.id ?? null };
}

export const rememberMessageFn = inngest.createFunction(
  {
    id: "b-remember-message",
    name: "Remember message",
    triggers: [{ event: "message.stored" }],
    idempotency: "event.data.message_id",
    retries: 2,
  },
  async ({ event, step }) => {
    const input = event.data as EventMap["message.stored"];
    const saved = await step.run("remember", () => rememberMessage(input));
    if (!("message_id" in saved) || !saved.vendors.length) return saved;
    const proposed = await step.run("propose rating", async () => {
      const text = messageText((await loadMessage(saved.message_id))!);
      const out = await proposeFromText({ text, candidates: saved.vendors, caseId: saved.case_id, messageId: saved.message_id, memoryRefId: saved.memory_ref_id });
      return { action_id: out.action?.id ?? null, reason: out.reason ?? null };
    });
    return { ...saved, proposed };
  },
);
