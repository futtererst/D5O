"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NotificationSettingsView } from "@/app/work/settings/NotificationSettingsView";
import type { WorkspaceKey } from "./schedule-model";

export function AccountMenu({ workspace, onExportSnapshot, snapshotReady = false, hostedPreview = false }: { workspace: WorkspaceKey; onExportSnapshot?: () => void; snapshotReady?: boolean; hostedPreview?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const trigger = triggerRef.current;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); trigger?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawerOpen(false); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", dismiss);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", dismiss);
      trigger?.focus();
    };
  }, [drawerOpen]);

  return <div className="d5o-account-menu" ref={menuRef}>
    <button ref={triggerRef} type="button" className="d5o-account-trigger" aria-haspopup="menu" aria-expanded={menuOpen}
      onClick={() => setMenuOpen((open) => !open)}>Account <span aria-hidden="true">▾</span></button>
    {menuOpen ? <div className="d5o-account-popover" role="menu" aria-label="Account">
      <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setDrawerOpen(true); }}>Notification preferences</button>
      {onExportSnapshot ? <button role="menuitem" type="button" disabled={!snapshotReady} onClick={() => { setMenuOpen(false); onExportSnapshot(); }}>Download prototype Work Record snapshot</button> : null}
      <Link role="menuitem" href="/auth/sign-out" prefetch={false}>Sign out</Link>
    </div> : null}
    {drawerOpen ? createPortal(<div className="d5o-account-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
      <section ref={drawerRef} className={`d5o-account-drawer d5o-account-drawer-${workspace}`} role="dialog" aria-modal="true" aria-label="Notification preferences">
        <header className="d5o-account-drawer-header"><div><span>YOUR ACCOUNT</span><h2>Notification preferences</h2></div>
          <button ref={closeRef} type="button" aria-label="Close notification preferences" onClick={() => setDrawerOpen(false)}>×</button></header>
        {hostedPreview ? <div className="d5o-notification-settings"><div className="d5o-notification-content"><div className="d5o-notification-intro"><p>ACCOUNT PREFERENCES · ALL WORKSPACES</p><h2>External delivery is not connected in this preview.</h2><span>Bookings are saved to the shared synthetic schedule. Email, SMS and push delivery require verified account destinations and configured providers before choices can be enabled.</span></div></div></div> : <NotificationSettingsView />}
      </section>
    </div>, document.body) : null}
  </div>;
}
