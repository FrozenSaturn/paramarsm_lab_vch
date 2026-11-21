"use client";
/** Approve and Reject buttons for one action. They call A's routes; the server checks the role. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { s } from "./ui";

export function ActionButtons({ actionId, payload }: { actionId: string; payload?: Record<string, unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (what: "approve" | "reject", body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/actions/${actionId}/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.error) {
        setError(res.status === 403 ? `Your role cannot ${what} this action.` : String(out.error ?? `HTTP ${res.status}`));
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reject = () => {
    const reason = window.prompt("Reason for the rejection?");
    if (reason === null) return;
    void call("reject", { reason });
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={s.primary} disabled={busy} onClick={() => call("approve", payload ? { payload } : {})}>Approve</button>
      <button type="button" style={s.button} disabled={busy} onClick={reject}>Reject</button>
      {busy && <span style={s.muted}>Working…</span>}
      {error && <span style={{ color: "#991b1b", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
