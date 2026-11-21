import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { proposeAction } from "@/executor";
import { createDraft } from "@/channels/gmail/drafts";
import { pollMailbox } from "@/channels/gmail/poller";
import { ApproveButton } from "./approve-button";
export const dynamic = "force-dynamic";

async function draft(form: FormData) {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  const user = await requireRole("admin", "contracts_engineer");
  const to = String(form.get("to") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const mail = { to, subject: String(form.get("subject") ?? ""), body: String(form.get("body") ?? "") };
  const { draftId } = await createDraft(user.id, mail);
  await proposeAction("send_email", null, { ...mail, draft_id: draftId }, { proposedBy: "dev" });
  revalidatePath("/dev/mail");
}

async function pollNow() {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  const user = await requireRole("admin", "contracts_engineer");
  const r = await pollMailbox(user.id);
  await admin().from("agent_steps").insert({ workflow: "gmail-poll", step: "poll now", output: r, status: "done", finished_at: new Date().toISOString() });
  revalidatePath("/dev/mail");
}

export default async function DevMail() {
  if (process.env.NODE_ENV === "production") notFound();
  const user = await requireRole("admin", "contracts_engineer");
  const db = admin();
  const { data: token } = await db.from("mail_tokens").select("updated_at").eq("user_id", user.id).maybeSingle();
  const { data: lastPoll } = await db.from("agent_steps").select("output,finished_at").eq("workflow", "gmail-poll").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const { data: acts } = await db.from("actions").select("id,status,payload,error").eq("kind", "send_email").order("created_at", { ascending: false }).limit(10);
  return (
    <>
      <h1>Dev: send mail</h1>
      <p>Signed in as {user.email} ({user.role}). Gmail token: {token ? "saved" : "MISSING: sign out and sign in again with Google"}.</p>
      <form action={draft} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
        <input name="to" placeholder="to (comma separated)" required />
        <input name="subject" placeholder="subject" required />
        <textarea name="body" placeholder="body" rows={4} required />
        <button>Create Gmail draft and propose send</button>
      </form>
      <form action={pollNow}><button>Poll Gmail now</button> Last poll: {lastPoll ? `${lastPoll.finished_at} ${JSON.stringify(lastPoll.output)}` : "never (the first poll sets the starting point and imports nothing)"}</form>
      <h2>Actions</h2>
      <ul>{(acts ?? []).map(a => (
        <li key={a.id}>{a.id.slice(0, 8)} [{a.status}] {(a.payload as any).subject} to {(a.payload as any).to?.join(", ")}
          {["proposed", "edited"].includes(a.status) && <> <ApproveButton id={a.id} /></>}
          {a.error && <> error: {a.error}</>}</li>))}</ul>
    </>
  );
}
