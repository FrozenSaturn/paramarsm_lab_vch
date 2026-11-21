import Link from "next/link";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/supabase";
import { requirePageUser, requireRole } from "@/lib/auth";
import { prepareTender } from "@/tender/prepare";
import { findSimilarTenders } from "@/tender/similar";
import { proposeReminders } from "@/tender/chase";
import { DraftEditor } from "@/components/DraftEditor";
import { BatchButton } from "./batch-button";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function Tender({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const db = admin();
  const { data: cs } = await db.from("cases").select("id, title, stage").eq("id", id).single();
  if (!cs) return <p>Case not found.</p>;
  const { data: rfq } = await db.from("rfqs").select("id, ref, due_date, status").eq("case_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  async function prepare(form: FormData) {
    "use server";
    await requireRole("contracts_engineer", "admin");
    await prepareTender({ caseId: id, dueDate: String(form.get("due") || "") || undefined });
    revalidatePath(`/cases/${id}/tender`);
  }
  async function remind() {
    "use server";
    await requireRole("contracts_engineer", "admin");
    await proposeReminders(rfq!.id);
    revalidatePath(`/cases/${id}/tender`);
  }

  if (!rfq) {
    const similar = await findSimilarTenders(id);
    return (
      <>
        <p><Link href={`/cases/${id}`}>Back to case</Link></p>
        <h1>Tender for {cs.title}</h1>
        {similar.length > 0 && <div className="notice notice-warn" style={{ display: "block" }}><b>Similar tender found.</b>{similar.map(s => <div key={s.rfqRef}>{s.rfqRef} "{s.caseTitle}" ({s.status}, {s.quotesIn} quotes in, score {s.score}): {s.reasons.join("; ")}</div>)}</div>}
        <p>The BOQ must be accepted and every line must have a confirmed item code.</p>
        <form action={prepare}><label>Quote due date <input type="date" name="due" /></label> (default: 7 days) <button>Prepare tender and draft RFQs</button></form>
      </>
    );
  }

  const [{ data: rrs }, { data: quotes }, { data: acts }] = await Promise.all([
    db.from("rfq_recipients").select("id, email, status, sent_at, reminders_sent, vendors!inner(name)").eq("rfq_id", rfq.id),
    db.from("quotes").select("vendor_id, rfq_id").eq("rfq_id", rfq.id),
    db.from("actions").select("id, kind, status, payload, original_payload, error").eq("case_id", id).in("kind", ["send_email", "send_reminder"]).order("created_at"),
  ]);
  const vendorQuoted = new Set((quotes ?? []).map(q => q.vendor_id));
  const mine = (acts ?? []).filter(a => (rrs ?? []).some(r => r.id === (a.original_payload as any)?.rfq_recipient_id));
  const drafts = mine.filter(a => a.kind === "send_email" && ["proposed", "edited"].includes(a.status));
  const reminders = mine.filter(a => a.kind === "send_reminder" && ["proposed", "edited"].includes(a.status));

  return (
    <>
      <p><Link href={`/cases/${id}`}>Back to case</Link></p>
      <h1>{rfq.ref}: {cs.title} ({rfq.status})</h1>
      <p>Quote due {rfq.due_date}. The SOP needs at least 3 vendors.</p>

      <h2>Vendors</h2>
      <table><thead><tr><th align="left">Vendor</th><th align="left">Email</th><th align="left">Mail</th><th align="left">Reminders</th><th align="left">Quote</th></tr></thead>
        <tbody>{(rrs ?? []).map(r => <tr key={r.id}><td>{(r as any).vendors.name}</td><td>{r.email}</td><td>{r.status}{r.sent_at ? ` ${new Date(r.sent_at).toLocaleString()}` : ""}</td><td>{r.reminders_sent}</td><td>{vendorQuoted.has((r as any).vendor_id) ? "received" : "waiting"}</td></tr>)}</tbody></table>

      {drafts.length > 0 && <>
        <h2>Drafts waiting ({drafts.length})</h2>
        <p><BatchButton rfqId={rfq.id} count={drafts.length} /> Each mail is sent from your Gmail with the tender pack attached. You can also edit and send one at a time.</p>
        {drafts.map(a => <details key={a.id} style={{ margin: "8px 0" }}><summary>{((a.payload as any).to ?? []).join(", ")}</summary>
          {a.error && <p className="err">Last error: {a.error}</p>}
          <DraftEditor actionId={a.id} to={(a.payload as any).to ?? []} cc={(a.payload as any).cc} subject={(a.payload as any).subject} body={(a.payload as any).body} sendLabel="Send this RFQ" /></details>)}</>}

      <h2>Reminders</h2>
      {rfq.status === "sent" && <form action={remind}><button>Propose reminders now</button> (W4 does this by itself after the reminder delay)</form>}
      {reminders.map(a => <details key={a.id} style={{ margin: "8px 0" }} open><summary>Reminder to {((a.payload as any).to ?? []).join(", ")}</summary>
        <DraftEditor actionId={a.id} to={(a.payload as any).to ?? []} subject={(a.payload as any).subject} body={(a.payload as any).body} sendLabel="Send reminder" /></details>)}
      {!reminders.length && <p>No reminder is waiting.</p>}
    </>
  );
}
