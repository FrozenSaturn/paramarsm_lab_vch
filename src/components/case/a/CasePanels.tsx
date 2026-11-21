import { admin } from "@/lib/supabase";
import { ActionButtons } from "@/components/ActionButtons";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/** The conversation of a case across channels: mail in, mail out. */
export async function ConversationList({ caseId }: { caseId: string }) {
  const { data } = await admin().from("messages").select("id, channel, direction, sender, recipients, subject, body, classification, created_at").eq("case_id", caseId).order("created_at");
  if (!data?.length) return <p>No messages for this case yet.</p>;
  return (
    <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
      {data.map(m => (
        <li key={m.id}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {m.direction === "in" ? "From" : "To"} {m.direction === "in" ? m.sender : (m.recipients ?? []).join(", ")} · {m.channel} · {when(m.created_at)}{m.classification ? ` · ${m.classification.replace(/_/g, " ")}` : ""}
          </div>
          <div><b>{m.subject}</b></div>
          {m.body && <div style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>{m.body.length > 280 ? `${m.body.slice(0, 280)}...` : m.body}</div>}
        </li>))}
    </ol>
  );
}

/** Proposed actions that wait for a person. A person can approve or reject here. Edits happen on the BOQ and Tender pages. */
export async function PendingActions({ caseId }: { caseId: string }) {
  const { data } = await admin().from("actions").select("id, kind, payload, created_at").eq("case_id", caseId).in("status", ["proposed", "edited"]).order("created_at");
  if (!data?.length) return <p>Nothing waits for approval.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
      {data.map(a => {
        const p = a.payload as any;
        return (
          <li key={a.id}>
            <div><b>{a.kind.replace(/_/g, " ")}</b>{p?.subject ? `: ${p.subject}` : ""}</div>
            {Array.isArray(p?.to) && p.to.length > 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>to {p.to.join(", ")}</div>}
            <ActionButtons actionId={a.id} />
          </li>);
      })}
    </ul>
  );
}

/** What the agents did, newest first, with the reason in plain words. */
export async function ActivityList({ caseId }: { caseId: string }) {
  const { data } = await admin().from("agent_steps").select("id, workflow, step, status, reasoning, started_at").eq("case_id", caseId).order("started_at", { ascending: false }).limit(25);
  if (!data?.length) return <p>No agent steps yet.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
      {data.map(s => (
        <li key={s.id}>
          <div><b>{s.workflow}</b> {s.step} <span style={{ opacity: 0.6 }}>· {s.status} · {when(s.started_at)}</span></div>
          {s.reasoning && <div style={{ fontSize: 12, opacity: 0.75 }}>{s.reasoning.length > 220 ? `${s.reasoning.slice(0, 220)}...` : s.reasoning}</div>}
        </li>))}
    </ul>
  );
}
