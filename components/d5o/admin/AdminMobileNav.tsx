"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type Section = readonly [string, string];

export function AdminMobileNav({ active, sections, workspace }: {
  active: string; sections: readonly Section[]; workspace: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const previousOverflow = useRef("");
  useEffect(() => () => { if (dialogRef.current?.open) document.body.style.overflow = previousOverflow.current; }, []);
  const close = () => dialogRef.current?.close();
  return <div className="d5o-admin-mobile-nav">
    <button ref={openerRef} type="button" aria-haspopup="dialog" aria-controls="d5o-admin-nav-dialog"
      onClick={() => { previousOverflow.current = document.body.style.overflow; document.body.style.overflow = "hidden"; dialogRef.current?.showModal(); }}>
      Administration menu <span>{sections.find(([key]) => key === active)?.[1]}</span>
    </button>
    <dialog id="d5o-admin-nav-dialog" ref={dialogRef} aria-label="Administration navigation"
      onClose={() => { document.body.style.overflow = previousOverflow.current; openerRef.current?.focus(); }}>
      <div className="d5o-admin-mobile-nav-heading"><strong>Administration</strong><button type="button" onClick={close}>Close menu</button></div>
      <nav aria-label="Administrator sections">{sections.map(([key, label]) =>
        <Link key={key} href={`/work/admin/${key}?workspace=${encodeURIComponent(workspace)}`}
          aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
      <Link className="d5o-admin-mobile-return" href={`/work?workspace=${encodeURIComponent(workspace)}`}>← Return to Work</Link>
    </dialog>
  </div>;
}
