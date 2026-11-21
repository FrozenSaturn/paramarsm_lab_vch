"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "./ui";

/** Approve and Reject for one pending action. It calls the executor routes. The server checks the role. */
export function VendorActionButtons({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(verb: "approve" | "reject") {
    let body: Record<string, unknown> = {};
    if (verb === "reject") {
      const reason = window.prompt("Reason for the rejection?");
      if (reason === null) return;
      body = { reason };
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/actions/${actionId}/${verb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) {
        setError(res.status === 403 ? "Your role cannot do this." : String(out.error ?? `HTTP ${res.status}`));
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={s.primary} disabled={busy} onClick={() => send("approve")}>Approve</button>
      <button type="button" style={s.button} disabled={busy} onClick={() => send("reject")}>Reject</button>
      {error && <span style={{ ...s.muted, color: "#991b1b" }}>{error}</span>}
    </span>
  );
}
