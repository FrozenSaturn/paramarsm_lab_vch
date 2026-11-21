"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The engineer edits the clarification, then sends it. Edit and approve are two calls so the edit stays on record. */
export function ClarificationEditor({ actionId, to, subject, body }: { actionId: string; to: string[]; subject: string; body: string }) {
  const router = useRouter();
  const [f, setF] = useState({ to: to.join(", "), subject, body });
  const [msg, setMsg] = useState("");
  const send = async () => {
    setMsg("sending...");
    const payload = { to: f.to.split(",").map(s => s.trim()).filter(Boolean), subject: f.subject, body: f.body };
    const e = await fetch(`/api/actions/${actionId}/edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
    if (!e.ok) return setMsg(`edit failed: ${(await e.json()).error}`);
    const a = await fetch(`/api/actions/${actionId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
    setMsg(a.ok ? "sent" : `send failed: ${(await a.json()).error}`);
    router.refresh();
  };
  const reject = async () => { await fetch(`/api/actions/${actionId}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "not needed" }) }); router.refresh(); };
  return (
    <div style={{ display: "grid", gap: 6, maxWidth: 640 }}>
      <input value={f.to} onChange={e => setF({ ...f, to: e.target.value })} placeholder="to (site engineer email, comma separated)" />
      <input value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} />
      <textarea rows={10} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
      <div><button onClick={send}>Send clarification</button> <button onClick={reject}>Do not send</button> {msg}</div>
    </div>
  );
}
