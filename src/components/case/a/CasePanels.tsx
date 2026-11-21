import { redirect } from "next/navigation";
import { admin } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { runBoqCheck } from "@/boq/pipeline";
import { ActionButtons } from "@/components/ActionButtons";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/** The conversation of a case across channels: mail in, mail out. */
export async function ConversationList({ caseId }: { caseId: string }) {
  const db = admin();
  const { data } = await db.from("messages").select("id, channel, direction, sender, recipients, subject, body, classification, created_at").eq("case_id", caseId).order("created_at");
  if (!data?.length) return <p>No messages for this case yet.</p>;
  const { data: docs } = await db.from("documents").select("id, message_id, filename, mime").in("message_id", data.map(m => m.id));
  const sheetsOf = (mid: string) => (docs ?? []).filter(d => d.message_id === mid && /spreadsheet|excel|\.xlsx$/i.test(`${d.mime} ${d.filename}`));

  /** A sheet that arrives on an existing case waits for a person. This button is that person's decision. */
  async function readAsBoq(form: FormData) {
    "use server";
    await requireRole("contracts_engineer", "admin");
    const documentId = String(form.get("document"));
    const { data: d } = await admin().from("documents").select("id, case_id").eq("id", documentId).single();
    if (!d?.case_id) throw new Error("This file is not on a case.");
    const { data: inbound } = await admin().from("messages").select("subject, body").eq("case_id", d.case_id).eq("direction", "in").order("created_at");
    await runBoqCheck({ caseId: d.case_id, documentId, requirementText: (inbound ?? []).map(m => `${m.subject ?? ""}\n${m.body ?? ""}`).join("\n") });
    redirect(`/cases/${d.case_id}/boq`);
  }
  return (
    <ol style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
      {data.map(m => (
        <li key={m.id}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {m.direction === "in" ? "From" : "To"} {m.direction === "in" ? m.sender : (m.recipients ?? []).join(", ")} · {m.channel} · {when(m.created_at)}{m.classification ? ` · ${m.classification.replace(/_/g, " ")}` : ""}
          </div>
          <div><b>{m.subject}</b></div>
          {m.body && <div style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>{m.body.length > 280 ? `${m.body.slice(0, 280)}...` : m.body}</div>}
          {sheetsOf(m.id).map(d => (
            <form key={d.id} action={readAsBoq} style={{ marginTop: 4 }}>
              <input type="hidden" name="document" value={d.id} />
              <span style={{ opacity: 0.8 }}>{d.filename} </span><button>Read as the BOQ</button>
            </form>))}
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
