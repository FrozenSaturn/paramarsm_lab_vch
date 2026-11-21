"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type NavItem = { href: string; label: string };

const ICONS: Record<string, string> = {
  "/inbox": "M3 13l2-8h14l2 8M3 13v6h18v-6M3 13h5l1 3h6l1-3h5",
  "/cases": "M4 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V6z",
  "/item-codes": "M4 7h16M4 12h16M4 17h10",
  "/settings": "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.5a7 7 0 00-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.5a7 7 0 002-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  "/approvals": "M5 12l4 4 10-10",
  "/vendors": "M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6",
  "/audit": "M12 8v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  "/search": "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3",
};
const FALLBACK = "M4 4h16v16H4z";

function Icon({ href }: { href: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[href] ?? FALLBACK} /></svg>;
}

const active = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function Shell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  // The login page has no app chrome.
  if (path.startsWith("/login")) return <div className="bare">{children}</div>;

  const current = nav.find(n => active(path, n.href));
  const dev = path.startsWith("/dev");

  return (
    <div className="shell" data-nav={open ? "open" : "closed"}>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/cases" className="brand">
          <span className="brand-mark">V</span>
          <span>Vinayak<small>Procurement workspace</small></span>
        </Link>
        <div className="nav-label">Workspace</div>
        {nav.map(n => (
          <Link key={n.href} href={n.href} className="nav-item" aria-current={active(path, n.href) ? "page" : undefined}>
            <Icon href={n.href} />{n.label}
          </Link>
        ))}
        <div className="sidebar-foot">Agents draft. A person approves every send and every decision.</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="menu-btn btn-ghost" onClick={() => setOpen(o => !o)} aria-label="Open menu">☰</button>
          <div className="crumbs">
            {dev ? <><span>Developer</span><span className="sep">/</span><b>{path.replace("/dev/", "") || "tools"}</b></>
              : <b>{current?.label ?? "Workspace"}</b>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
