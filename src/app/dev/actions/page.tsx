import { notFound } from "next/navigation";
import { admin } from "@/lib/supabase";
import { proposeAction } from "@/executor";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
export const dynamic = "force-dynamic";

async function propose() {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  const user = await requireRole("admin");
  // A dummy mail to yourself. With MAIL_DRY_RUN=true nothing is sent.
  await proposeAction("send_email", null, { to: [user.email], subject: "Dev test of the approval path", body: "This is a dummy mail." }, { proposedBy: "dev" });
  revalidatePath("/dev/actions");
}
export default async function Dev() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireRole("admin");
  const { data } = await admin().from("actions").select("id,kind,status").order("created_at", { ascending: false }).limit(10);
  return <><h1>Dev: actions</h1><form action={propose}><button>Propose dummy action</button></form>
    <p>Approve with POST /api/actions/:id/approve while signed in.</p>
    <ul>{(data ?? []).map(a => <li key={a.id}>{a.id.slice(0, 8)} {a.kind} {a.status}</li>)}</ul></>;
}
