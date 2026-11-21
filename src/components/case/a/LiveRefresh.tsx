"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page when this case gets a new agent step, action or message. Uses Supabase Realtime. */
export function LiveRefresh({ caseId }: { caseId: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => router.refresh(), 400); }; // many rows can arrive together
    const ch = sb.channel(`case-${caseId}`);
    for (const table of ["agent_steps", "actions", "messages"])
      ch.on("postgres_changes", { event: "*", schema: "public", table, filter: `case_id=eq.${caseId}` }, refresh);
    ch.subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(ch); };
  }, [caseId, router]);
  return null;
}
