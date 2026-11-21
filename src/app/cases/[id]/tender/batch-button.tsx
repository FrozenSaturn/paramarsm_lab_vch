"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function BatchButton({ rfqId, count }: { rfqId: string; count: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const go = async () => {
    setMsg("sending...");
    const r = await fetch(`/api/rfqs/${rfqId}/approve-batch`, { method: "POST" });
    const j = await r.json();
    setMsg(r.ok ? `sent ${j.sent.length}${j.failed.length ? `, failed ${j.failed.length}: ${j.failed.map((f: any) => `${f.vendor} (${f.error})`).join("; ")}` : ""}` : j.error);
    router.refresh();
  };
  return <span><button onClick={go}>Approve and send all {count} RFQs</button> {msg}</span>;
}
