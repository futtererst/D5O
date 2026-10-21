"use client";

import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { PlatformWordmark } from "./PlatformWordmark";
import type { WorkspaceKey } from "./schedule-model";
import styles from "./D5OProductHeader.module.css";

/** Shared identity bar for the focused worker and administrator surfaces. */
export function D5OProductHeader({ workspace, homeHref, area, hostedPreview = false }: {
  workspace: WorkspaceKey;
  homeHref: string;
  area: string;
  hostedPreview?: boolean;
}) {
  const workspaceName = workspace === "rybex" ? "Rybex Delivery" : "Rotork Service";
  return <header className={styles.header} data-workspace={workspace}>
    <Link className={styles.brand} href={homeHref} aria-label={`D5O — ${area}`}>
      <PlatformWordmark /><span>System of work</span>
    </Link>
    <div className={styles.context}><span>WORKSPACE</span><strong>{workspaceName}</strong><small>{area}</small></div>
    <AccountMenu workspace={workspace} hostedPreview={hostedPreview} />
  </header>;
}
