import { requirePageUser } from "@/lib/auth";
import Link from "next/link";
import { admin } from "@/lib/supabase";
import { tabsA } from "@/components/case/a/tabs";
import { tabsB } from "@/components/case/b/tabs";
import { Panel, Pill, Empty, label, stageTone, ago } from "@/components/ui";
import { ConversationList, PendingActions, ActivityList } from "@/components/case/a/CasePanels";
import { LiveRefresh } from "@/components/case/a/LiveRefresh";
export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const db = admin();
  const [{ data: c }, { data: steps }, { data: pending }] = await Promise.all([
    db.from("cases").select("*").eq("id", id).single(),
    db.from("agent_steps").select("id,step,status,reasoning").eq("case_id", id).order("started_at", { ascending: false }).limit(20),
    db.from("actions").select("id,kind,status").eq("case_id", id).in("status", ["proposed", "edited"]),
  ]);
  if (!c) return <div className="notice notice-warn">Case not found.</div>;
  const tabs = [...tabsA, ...tabsB];
  const links = [
    { href: `/cases/${id}/boq`, title: "BOQ", sub: "Parsed lines and checks" },
    { href: `/cases/${id}/codes`, title: "Item codes", sub: "Match lines to the master" },
    { href: `/cases/${id}/tender`, title: "Tender", sub: "RFQ drafts, dispatch and chase" },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/cases">Cases</Link> / {label(c.stage)}</div>
          <h1>{c.title}</h1>
        </div>
        <div className="row"><Pill tone={stageTone(c.stage)}>{label(c.stage)}</Pill>{pending?.length ? <Pill tone="warn">{pending.length} waiting for approval</Pill> : null}</div>
      </div>

      <div className="workspace">
        <LiveRefresh caseId={id} />
        <Panel title="Conversation"><ConversationList caseId={id} /></Panel>

        <div className="stack">
          <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {links.map(l => (
              <Link key={l.href} href={l.href} className="tile-link"><div>{l.title}<br /><span>{l.sub}</span></div><span aria-hidden>→</span></Link>
            ))}
          </div>
          <Panel title="Workspace tabs"><div className="row">{tabs.map(t => <Pill key={t.id} tone="plain">{t.label}</Pill>)}</div></Panel>
        </div>

        <div className="stack">
          <Panel title="Pending approvals" meta={pending?.length ?? 0}>
            <PendingActions caseId={id} />
          </Panel>
          <Panel title="Agent activity" meta="live">
            <ActivityList caseId={id} />
          </Panel>
        </div>
      </div>
    </>
  );
}
