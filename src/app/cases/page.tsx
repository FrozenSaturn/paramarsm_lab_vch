import { requirePageUser } from "@/lib/auth";
import Link from "next/link";
import { admin } from "@/lib/supabase";
import { PageHead, Pill, Empty, label, stageTone } from "@/components/ui";
export const dynamic = "force-dynamic";

export default async function Cases() {
  await requirePageUser();
  const { data } = await admin().from("cases").select("id,title,stage,status").order("created_at", { ascending: false });
  const cases = data ?? [];
  return (
    <>
      <PageHead title="Cases" sub="Each case follows one work package from the site message to the approved vendor." />
      {cases.length === 0 && <div className="list"><Empty>No cases yet. A case appears when a site message arrives.</Empty></div>}
      <div className="card-grid">
        {cases.map(c => (
          <Link key={c.id} href={`/cases/${c.id}`} className="card card-link">
            <div className="row spread" style={{ marginBottom: 12 }}>
              <Pill tone={stageTone(c.stage)}>{label(c.stage)}</Pill>
              {c.status && <span className="muted">{label(c.status)}</span>}
            </div>
            <h3>{c.title}</h3>
          </Link>
        ))}
      </div>
    </>
  );
}
