import { admin } from "@/lib/supabase";
import { proposeAction } from "@/executor";
import { revalidatePath } from "next/cache";
export const dynamic = "force-dynamic";

async function propose() { "use server"; await proposeAction("send_whatsapp", null, { to: "demo", text: "hello" }, { proposedBy: "dev" }); revalidatePath("/dev/actions"); }
export default async function Dev() {
  const { data } = await admin().from("actions").select("id,kind,status").order("created_at", { ascending: false }).limit(10);
  return <><h1>Dev: actions</h1><form action={propose}><button>Propose dummy action</button></form>
    <p>Approve with POST /api/actions/:id/approve while signed in.</p>
    <ul>{(data ?? []).map(a => <li key={a.id}>{a.id.slice(0, 8)} {a.kind} {a.status}</li>)}</ul></>;
}
