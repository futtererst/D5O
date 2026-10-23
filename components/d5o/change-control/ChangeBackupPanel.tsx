import { backupStatusLabels, backupStatusTone } from "@/lib/d5o/change-control-config";
import { chipClass } from "@/lib/d5o/presentation";
import type { ChangeEvent } from "@/lib/d5o/types";

export function ChangeBackupPanel({ events }: { events: ChangeEvent[] }) {
  const gaps = events.filter((event) => ["missing", "partial"].includes(event.backupStatus));

  return (
    <section className="control-list">
      <h3>Backup Completeness</h3>
      {gaps.length > 0 ? (
        <ul className="compact-list">
          {gaps.map((event, index) => (
            <li key={`change-backup-${event.id}-${event.changeNumber}-${index}`}>
              <span className="artifact-state artifact-pending" />
              <span>
                <strong>{event.changeNumber}: {event.title}</strong>
                <small className="muted">{event.projectName} | {event.attachments.length} attachment(s)</small>
                <p><span className={chipClass(backupStatusTone[event.backupStatus])}>{backupStatusLabels[event.backupStatus]}</span> {event.requiredAction}</p>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">All open change events have complete backup.</p>
      )}
    </section>
  );
}
