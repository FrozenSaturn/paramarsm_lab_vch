"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CodeChoice({ lineId, itemCodeId, label, newCode }: { lineId: string; itemCodeId?: string; label: string; newCode?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const go = async () => {
    setMsg("...");
    const r = await fetch(`/api/boq-lines/${lineId}/confirm-code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newCode ? { newCode: true } : { itemCodeId }) });
    const j = await r.json();
    setMsg(r.ok ? "" : j.error);
    router.refresh();
  };
  return <span><button onClick={go}>{label}</button> {msg}</span>;
}
