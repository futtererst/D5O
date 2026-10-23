import { dateLabel } from "@/lib/d5o/presentation";
import type { ChangeEvent } from "@/lib/d5o/types";

export function NoticeDeadlineQueue({ events }: { events: ChangeEvent[] }) {
  const risks = events.filter(
    (event) => event.noticeRequired && !["submitted", "waived"].includes(event.noticeStatus)
  );

  return (
    <section className="control-list">
      <h3>Notice Deadline Queue</h3>
      {risks.length > 0 ? (
        <ul className="compact-list">
          {risks.map((event, index) => (
            <li key={`notice-risk-${event.id}-${event.changeNumber}-${index}`}>
              <span className="artifact-state artifact-missing" />
              <span>
                <strong>{event.changeNumber}: {event.title}</strong>
                <small className="muted">{event.projectName} | due {dateLabel(event.noticeDeadline)}</small>
                <p>{event.businessImpact}</p>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No unsubmitted notice deadlines are at risk.</p>
      )}
    </section>
  );
}
