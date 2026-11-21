import { admin } from "@/lib/supabase";
import { tabsA } from "@/components/case/a/tabs";
import { tabsB } from "@/components/case/b/tabs";
export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = admin();
  const [{ data: c }, { data: steps }, { data: pending }] = await Promise.all([
    db.from("cases").select("*").eq("id", id).single(),
    db.from("agent_steps").select("id,step,status,reasoning").eq("case_id", id).order("started_at", { ascending: false }).limit(20),
    db.from("actions").select("id,kind,status").eq("case_id", id).in("status", ["proposed", "edited"]),
  ]);
  if (!c) return <p>Case not found</p>;
  const tabs = [...tabsA, ...tabsB];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 16 }}>
      <section><h3>Conversation</h3></section>
      <section><h2>{c.title}</h2><p>Stage: {c.stage}</p><p>Tabs: {tabs.map(t => t.label).join(" · ")}</p></section>
      <aside>
        <h3>Pending approvals</h3><ul>{(pending ?? []).map(a => <li key={a.id}>{a.kind}</li>)}</ul>
        <h3>Agent activity</h3><ul>{(steps ?? []).map(s => <li key={s.id}>{s.step} ({s.status})</li>)}</ul>
      </aside>
    </div>
  );
}
