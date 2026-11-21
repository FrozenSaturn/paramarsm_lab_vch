import Link from "next/link";
import { admin } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Cases() {
  const { data } = await admin().from("cases").select("id,title,stage,status").order("created_at", { ascending: false });
  return <><h1>Cases</h1><ul>{(data ?? []).map(c => <li key={c.id}><Link href={`/cases/${c.id}`}>{c.title}</Link> — {c.stage}</li>)}</ul></>;
}
