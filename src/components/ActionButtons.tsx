"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Approve or reject one proposed action. The server checks the role again. */
export function ActionButtons({ actionId, approveLabel = "Approve" }: { actionId: string; approveLabel?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const go = async (kind: "approve" | "reject") => {
    setMsg("...");
    const r = await fetch(`/api/actions/${actionId}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "rejected in the app" }) });
    setMsg(r.ok ? "" : (await r.json()).error);
    router.refresh();
  };
  return <span><button onClick={() => go("approve")}>{approveLabel}</button> <button onClick={() => go("reject")}>Reject</button> {msg}</span>;
}
