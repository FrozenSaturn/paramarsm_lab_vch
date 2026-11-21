import { requirePageUser } from "@/lib/auth";
import AuditTimeline from "@/components/case/b/AuditTimeline";
import { parseAuditQuery } from "@/components/case/b/audit-data";
export const dynamic = "force-dynamic";

/** Audit: events, agent steps, actions with receipts and HOD decisions in one list. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser();
  const query = parseAuditQuery(await searchParams);
  return (
    <main style={{ padding: 16 }}>
      <h1>Audit</h1>
      <AuditTimeline query={query} />
    </main>
  );
}
