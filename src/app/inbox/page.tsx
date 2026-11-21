import { requirePageUser } from "@/lib/auth";
import { admin } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Inbox() {
  await requirePageUser();
  const { data } = await admin().from("messages").select("id,channel,sender,subject,classification,created_at").eq("direction", "in").order("created_at", { ascending: false }).limit(50);
  return <><h1>Inbox</h1><ul>{(data ?? []).map(m => <li key={m.id}>[{m.channel}] {m.sender}: {m.subject} ({m.classification ?? "unclassified"})</li>)}</ul></>;
}
