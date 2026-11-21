import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { admin } from "@/lib/supabase";
import { getUser, requireRole, VIEW_AS_COOKIE } from "@/lib/auth";
import { pollMailbox } from "@/channels/gmail/poller";

const ROLES = ["contracts_engineer", "hod", "site_engineer", "management", "admin"] as const;
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "never");
const flag = (v: string | undefined, yes = "on", no = "off") => (v === "true" ? yes : no);

export async function MailboxPanel() {
  const user = await getUser();
  const db = admin();
  const { data: tok } = user ? await db.from("mail_tokens").select("history_id, updated_at").eq("user_id", user.id).maybeSingle() : { data: null };
  const { data: last } = await db.from("agent_steps").select("output, finished_at").eq("workflow", "gmail-poll").order("started_at", { ascending: false }).limit(1).maybeSingle();

  async function pollNow() {
    "use server";
    const u = await requireRole("contracts_engineer", "admin");
    const r = await pollMailbox(u.id);
    await admin().from("agent_steps").insert({ workflow: "gmail-poll", step: "poll now", output: r, status: "done", finished_at: new Date().toISOString() });
    revalidatePath("/settings");
  }
  return (
    <div>
      <p>Gmail token: <b>{tok ? "saved" : "missing. Sign out and sign in again with Google."}</b>{tok ? ` (updated ${dt(tok.updated_at)})` : ""}</p>
      <p>Poller on this machine: <b>{flag(process.env.RUN_INGEST)}</b> (only one machine may run it). Last poll: {dt(last?.finished_at)}{last ? ` ${JSON.stringify(last.output)}` : ""}</p>
      {(user?.role === "contracts_engineer" || user?.role === "admin") && <form action={pollNow}><button>Poll Gmail now</button></form>}
    </div>
  );
}

/** The list of sign-in emails and roles is for admins. The table's own policy says the same. We read it with the service key, so we check here. */
export async function UsersPanel() {
  const user = await getUser();
  if (user?.role !== "admin") return <p>Only an admin can see the users and their roles.</p>;
  const db = admin();
  const [{ data: allowed }, { data: profiles }] = await Promise.all([db.from("allowed_users").select("email, role").order("role"), db.from("profiles").select("email")]);
  const signedIn = new Set((profiles ?? []).map(p => p.email.toLowerCase()));
  return (
    <table cellPadding={4}>
      <thead><tr><th align="left">Email</th><th align="left">Role</th><th align="left">Signed in before</th></tr></thead>
      <tbody>{(allowed ?? []).map(u => <tr key={u.email}><td>{u.email}</td><td>{u.role.replace(/_/g, " ")}</td><td>{signedIn.has(u.email.toLowerCase()) ? "yes" : "no"}</td></tr>)}</tbody>
    </table>
  );
}

/** Admin only. Shows the screens of another role. It does not reduce the admin's rights: the executor checks the stored role. */
export async function ViewAsPanel() {
  const user = await getUser();
  if (user?.realRole !== "admin") return <p>Only an admin can view the app as another role. Your role: {user?.realRole.replace(/_/g, " ")}.</p>;
  async function setView(form: FormData) {
    "use server";
    const u = await getUser();
    if (u?.realRole !== "admin") throw new Error("forbidden");
    const role = String(form.get("role") || "");
    const jar = await cookies();
    if (!role || role === "admin") jar.delete(VIEW_AS_COOKIE);
    else if ((ROLES as readonly string[]).includes(role)) jar.set(VIEW_AS_COOKIE, role, { httpOnly: true, sameSite: "lax", path: "/" });
    revalidatePath("/", "layout");
  }
  return (
    <form action={setView}>
      <label>View as <select name="role" defaultValue={user.role}>{ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}{r === "admin" ? " (normal)" : ""}</option>)}</select></label> <button>Apply</button>
      <p style={{ opacity: 0.7, margin: "4px 0 0" }}>Currently: {user.role.replace(/_/g, " ")}.</p>
    </form>
  );
}

export function PolicyPanel() {
  const rows: [string, string][] = [
    ["RFQ to vendors, clarification to site, counter-offer", "Always ask"],
    ["Reminder to a vendor", "Ask (the first reminder of a case is always proposed to a person)"],
    ["New item code, ERP import sheet", "Always ask"],
    ["Recommendation to the HOD", "Automatic (it is internal)"],
    ["Vendor selection, work order", "Human only. The agent has no action type for these"],
  ];
  return (
    <>
      <table cellPadding={4}><tbody>{rows.map(([a, p]) => <tr key={a}><td>{a}</td><td>{p}</td></tr>)}</tbody></table>
      <p style={{ opacity: 0.8 }}>
        Item-code judge: {process.env.CODE_JUDGE === "rules" || !process.env.ANTHROPIC_API_KEY ? "rules only" : `rules + ${process.env.CODE_JUDGE_MODEL || "claude-sonnet-5-5"}`} ·
        Triage model: {process.env.TRIAGE_MODEL || "claude-haiku-5-5"} · Mail dry run: {flag(process.env.MAIL_DRY_RUN)} ·
        Reminder after {Number(process.env.REMINDER_AFTER_MINUTES ?? 72 * 60)} min · Events start workflows: {flag(process.env.EMIT_DISPATCHES_TO_INNGEST, "yes", "no")}
      </p>
    </>
  );
}

/** WhatsApp link state, from B's bridge. The bridge token stays on the server. */
export async function WhatsAppPanel() {
  const { health, status } = await import("@/channels/whatsapp/bridge");
  const { knownNumbers } = await import("@/channels/whatsapp/numbers");
  const configured = !!process.env.WHATSAPP_BRIDGE_TOKEN;
  const db = admin();
  const [h, st, nums, { data: conn }, { data: lastMsg }] = await Promise.all([
    configured ? health() : Promise.resolve(null), configured ? status() : Promise.resolve(null), knownNumbers(),
    db.from("agent_steps").select("output, finished_at").eq("workflow", "whatsapp").eq("step", "connection").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("messages").select("created_at").eq("channel", "whatsapp").eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!configured) return <p>Not set up. Set <code>WHATSAPP_BRIDGE_TOKEN</code>, <code>WHATSAPP_FORWARD_TOKEN</code> and <code>WHATSAPP_BRIDGE_URL</code> in <code>.env</code>, then start <code>services/whatsapp</code> (<code>npm run up</code>).</p>;
  return (
    <div>
      <p>Bridge: <b>{h?.ok ? "reachable" : `not reachable${h?.error ? ` (${h.error})` : ""}`}</b>{h?.ok ? ` · Evolution: ${h.evolution ? "up" : "down"}` : ""}</p>
      <p>Phone link: <b>{st?.error ? `unknown (${st.error})` : st?.state ?? "unknown"}</b>{st?.owner ? ` · number ${st.owner}` : ""}. To link or re-link a phone, run <code>npm run wa -- link</code> in <code>services/whatsapp</code>, or open its link page.</p>
      <p>Allow-listed numbers: <b>{new Set(nums.map(n => n.number)).size}</b> ({nums.filter(n => n.who === "person").length} site, {nums.filter(n => n.who === "vendor").length} vendor, {nums.filter(n => n.who === "env").length} from <code>WHATSAPP_ALLOW_NUMBERS</code>). Messages from other numbers are dropped and not stored.</p>
      <p>Last inbound message: {dt(lastMsg?.created_at)} · Last link change: {conn ? `${(conn.output as any)?.state} at ${dt(conn.finished_at)}` : "none seen"}</p>
      <p style={{ opacity: 0.7 }}>Voice notes are stored but not transcribed yet. RFQs go by email, not WhatsApp.</p>
    </div>
  );
}
