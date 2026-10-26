"use client";

import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { PlatformWordmark } from "./PlatformWordmark";
import type { WorkspaceKey } from "./schedule-model";
import styles from "./D5OProductHeader.module.css";

/** Shared identity bar for the focused worker and administrator surfaces. */
export function D5OProductHeader({ workspace, homeHref, area, hostedPreview = false, organizationName }: {
  workspace: WorkspaceKey;
  homeHref: string;
  area: string;
  hostedPreview?: boolean;
  organizationName?: string;
}) {
  const workspaceName = organizationName ?? (workspace === "rybex" ? "Rybex Delivery" : workspace === "rotork" ? "Rotork Service" : workspace);
  return <header className={styles.header} data-workspace={workspace}>
    <Link className={styles.brand} href={homeHref} aria-label={`D5O — ${area}`}>
      <PlatformWordmark /><span>System of work</span>
    </Link>
    <div className={styles.context}><span>WORKSPACE</span><strong>{workspaceName}</strong><small>{area}</small></div>
    <AccountMenu workspace={workspace} hostedPreview={hostedPreview} />
  </header>;
}
