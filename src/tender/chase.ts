import { admin } from "../lib/supabase";
import { proposeAction } from "../executor";

const MIN = 60_000;
/** Reminder delay. The default is 72 hours. Set REMINDER_AFTER_MINUTES to a small number to show the timer in a demo. */
export const reminderDelayMs = () => Number(process.env.REMINDER_AFTER_MINUTES ?? 72 * 60) * MIN;

/** When to remind and when the RFQ is due. No reminder if it would fall on or after the due time. */
export function planChase(sentAt: Date, dueDate: string, delayMs = reminderDelayMs()) {
  const dueAt = new Date(`${dueDate}T23:59:59+05:30`); // end of the due day, India time
  const reminderAt = new Date(sentAt.getTime() + delayMs);
  return { dueAt, reminderAt: reminderAt < dueAt ? reminderAt : null };
}

/** Propose one reminder for each invited vendor that has not quoted and has not had a reminder. The engineer approves each one. */
export async function proposeReminders(rfqId: string) {
  const db = admin();
  const { data: rfq } = await db.from("rfqs").select("id, case_id, ref, due_date").eq("id", rfqId).single();
  if (!rfq) throw new Error("RFQ not found");
  const [{ data: rrs }, { data: quotes }, { data: open }] = await Promise.all([
    db.from("rfq_recipients").select("id, vendor_id, email, status, reminders_sent, gmail_thread_id, vendors!inner(name)").eq("rfq_id", rfqId),
    db.from("quotes").select("vendor_id").eq("rfq_id", rfqId),
    db.from("actions").select("original_payload").eq("case_id", rfq.case_id).eq("kind", "send_reminder").in("status", ["proposed", "edited"]),
  ]);
  const quoted = new Set((quotes ?? []).map(q => q.vendor_id));
  const pending = new Set((open ?? []).map(a => (a.original_payload as any)?.rfq_recipient_id));
  const out: { vendor: string; actionId: string }[] = [];
  for (const r of rrs ?? []) {
    if (r.status !== "sent" || (r.reminders_sent ?? 0) > 0 || quoted.has(r.vendor_id) || pending.has(r.id) || !r.email) continue;
    const { data: first } = await db.from("messages").select("subject").eq("direction", "out").eq("thread_id", r.gmail_thread_id ?? "").order("created_at").limit(1).maybeSingle();
    const subject = first?.subject ? `Re: ${first.subject.replace(/^Re:\s*/i, "")}` : `Reminder: quotation ${rfq.ref} [VIN-${rfq.ref}]`;
    const a = await proposeAction("send_reminder", rfq.case_id, {
      to: [r.email], subject, thread_id: r.gmail_thread_id ?? undefined, rfq_recipient_id: r.id,
      body: ["Dear Sir,", "", `This is a reminder for our request for quotation ${rfq.ref}. We have not received your quotation yet.`, `Please send it by ${rfq.due_date}. If you do not plan to quote, please tell us.`, "", "Thanks & Regards,", process.env.RFQ_SENDER || "Contracts & Planning, Vinayak Group"].join("\n"),
    }, { proposedBy: "W4" });
    out.push({ vendor: (r as any).vendors.name, actionId: a.id });
  }
  return out;
}
