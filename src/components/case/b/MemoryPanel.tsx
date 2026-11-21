import Link from "next/link";
import { admin } from "@/lib/supabase";
import { listMemories, type MemoryRow } from "@/memory";
import { deleteMemoryAction, proposeRatingAction } from "@/app/vendors/actions";
import { fmtDate } from "@/quotes/format";
import { DemoBadge } from "./DemoBadge";
import { Badge, s } from "./ui";

/** "What we remember": the memories of one entity, with Delete and Propose rating. Server component. */
export async function MemoryPanel({ entity, path }: { entity: string; path?: string }) {
  let rows: MemoryRow[] = [];
  let error: string | null = null;
  try {
    rows = await listMemories(entity);
  } catch (e) {
    error = (e as Error).message;
  }
  // The source messages, read only.
  const msgIds = [...new Set(rows.map((r) => r.message_id).filter(Boolean))] as string[];
  const { data: msgs } = msgIds.length
    ? await admin().from("messages").select("id,subject,sender,case_id").in("id", msgIds)
    : { data: [] as any[] };
  const msg = (id: string | null) => (id ? (msgs ?? []).find((m: any) => m.id === id) : undefined);
  const back = path ?? "/vendors";

  return (
    <section style={s.card}>
      <h3 style={{ marginTop: 0 }}>What we remember</h3>
      <p style={s.muted}>Memories give colour, not evidence. A memory alone never changes a score.</p>
      {error && <p style={{ ...s.muted, color: "#991b1b" }}>Memory read failed: {error}</p>}
      {!error && !rows.length && <p style={s.muted}>No memories yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {rows.map((r) => {
          const m = msg(r.message_id);
          return (
            <li key={r.id} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
              <div>
                {r.text ?? <em>(no text)</em>}
                <DemoBadge show={r.is_demo} />
                {r.pending && <Badge tone="warn" title="Not yet confirmed by mem0">pending</Badge>}
              </div>
              <div style={s.muted}>
                {fmtDate(r.created_at)}
                {m && (
                  <>
                    {" · from "}
                    {m.case_id ? <Link href={`/cases/${m.case_id}`}>{m.subject || "(no subject)"}</Link> : <span>{m.subject || "(no subject)"}</span>}
                    {m.sender ? ` (${m.sender})` : ""}
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <form action={proposeRatingAction}>
                  <input type="hidden" name="memory_id" value={r.id} />
                  <input type="hidden" name="path" value={back} />
                  <button type="submit" style={s.button}>Propose rating</button>
                </form>
                <form action={deleteMemoryAction}>
                  <input type="hidden" name="memory_id" value={r.id} />
                  <input type="hidden" name="path" value={back} />
                  <button type="submit" style={{ ...s.button, color: "#991b1b" }}>Delete</button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
