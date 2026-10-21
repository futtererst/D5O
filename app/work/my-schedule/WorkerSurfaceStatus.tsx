import Link from "next/link";
import { D5OProductHeader } from "@/components/d5o/platform/D5OProductHeader";
import type { WorkspaceKey } from "@/components/d5o/platform/schedule-model";
import styles from "./worker-status.module.css";

export function WorkerSurfaceStatus({ workspace = "rybex", title, message, showScheduleLink = true, hosted = true }: {
  workspace?: WorkspaceKey;
  title: string;
  message: string;
  showScheduleLink?: boolean;
  hosted?: boolean;
}) {
  return <><D5OProductHeader workspace={workspace} homeHref={`/work/my-schedule?workspace=${workspace}`} area="My schedule" hostedPreview={hosted} />
    <main className={styles.surface}><section role="status"><p>MY CREW SCHEDULE</p><h1>{title}</h1><p>{message}</p>
      {showScheduleLink && <Link href={`/work/my-schedule?workspace=${workspace}`}>Return to My schedule →</Link>}
    </section></main></>;
}
