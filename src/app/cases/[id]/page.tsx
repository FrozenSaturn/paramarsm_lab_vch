import { requirePageUser } from "@/lib/auth";
import Link from "next/link";
import { admin } from "@/lib/supabase";
import { tabsA } from "@/components/case/a/tabs";
import { tabsB } from "@/components/case/b/tabs";
import { ConversationList, PendingActions, ActivityList } from "@/components/case/a/CasePanels";
import { LiveRefresh } from "@/components/case/a/LiveRefresh";
export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const db = admin();
  const [{ data: c }, { data: pending }] = await Promise.all([
    db.from("cases").select("*").eq("id", id).single(),
    db.from("actions").select("id,kind,status").eq("case_id", id).in("status", ["proposed", "edited"]),
  ]);
  if (!c) return <p>Case not found</p>;
  const tabs = [...tabsA, ...tabsB];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 16 }}>
      <LiveRefresh caseId={id} />
      <section><h3>Conversation</h3><ConversationList caseId={id} /></section>
      <section><h2>{c.title}</h2><p>Stage: {c.stage}</p><p>Tabs: {tabs.map(t => t.label).join(" · ")}</p><p><Link href={`/cases/${id}/boq`}>BOQ</Link> | <Link href={`/cases/${id}/codes`}>Item codes</Link> | <Link href={`/cases/${id}/tender`}>Tender</Link></p></section>
      <aside>
        <h3>Pending approvals ({pending?.length ?? 0})</h3><PendingActions caseId={id} />
        <h3>Agent activity</h3><ActivityList caseId={id} />
      </aside>
    </div>
  );
}
