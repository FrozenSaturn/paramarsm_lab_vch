import type { ReactNode } from "react";
import Link from "next/link";
import { navA } from "./nav.a";
import { navB } from "./nav.b";

export const metadata = { title: "Vinayak procurement" };
export default function Root({ children }: { children: ReactNode }) {
  const sandbox = (process.env.OUTBOUND_MODE ?? "sandbox") === "sandbox";
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui", margin: 0 }}>
      {sandbox && <div style={{ background: "#fde68a", padding: "4px 12px", fontSize: 13 }}>Sandbox: mail goes to demo inboxes only</div>}
      <nav style={{ display: "flex", gap: 16, padding: 12, borderBottom: "1px solid #ddd" }}>
        {[...navA, ...navB].map(n => <Link key={n.href} href={n.href}>{n.label}</Link>)}
      </nav>
      <main style={{ padding: 16 }}>{children}</main>
    </body></html>
  );
}
