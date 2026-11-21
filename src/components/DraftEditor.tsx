"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Edit one proposed mail, then send it. Edit and approve are two calls so the edit stays on record. */
export function DraftEditor({ actionId, to, cc, subject, body, sendLabel = "Send" }: { actionId: string; to: string[]; cc?: string[]; subject: string; body: string; sendLabel?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ to: to.join(", "), cc: (cc ?? []).join(", "), subject, body });
  const [msg, setMsg] = useState("");
  const list = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);
  const post = (path: string, payload?: object) => fetch(`/api/actions/${actionId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
  const send = async () => {
    setMsg("sending...");
    const payload = { to: list(f.to), cc: list(f.cc), subject: f.subject, body: f.body };
    const e = await post("edit", { payload });
    if (!e.ok) return setMsg(`edit failed: ${(await e.json()).error}`);
    const a = await post("approve", { payload });
    setMsg(a.ok ? "sent" : `send failed: ${(await a.json()).error}`);
    router.refresh();
  };
  const reject = async () => { await post("reject", { reason: "not needed" }); router.refresh(); };
  return (
    <div style={{ display: "grid", gap: 6, maxWidth: 640 }}>
      <input value={f.to} onChange={e => setF({ ...f, to: e.target.value })} placeholder="to" />
      <input value={f.cc} onChange={e => setF({ ...f, cc: e.target.value })} placeholder="cc" />
      <input value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} />
      <textarea rows={9} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
      <div><button onClick={send}>{sendLabel}</button> <button onClick={reject}>Do not send</button> {msg}</div>
    </div>
  );
}
