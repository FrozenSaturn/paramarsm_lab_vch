"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApproveButton({ id }: { id: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const go = async (kind: "approve" | "reject") => {
    setMsg("working...");
    const r = await fetch(`/api/actions/${id}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "dev" }) });
    const j = await r.json();
    setMsg(r.ok ? "done" : `error: ${j.error}`);
    router.refresh();
  };
  return <span><button onClick={() => go("approve")}>Approve and send</button> <button onClick={() => go("reject")}>Reject</button> {msg}</span>;
}
