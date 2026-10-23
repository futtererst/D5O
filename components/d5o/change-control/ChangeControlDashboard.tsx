import { ChangeBackupPanel } from "./ChangeBackupPanel";
import { ChangeControlScoreCard } from "./ChangeControlScoreCard";
import { ChangeEventCard } from "./ChangeEventCard";
import { ChangeEventTable } from "./ChangeEventTable";
import { CommercialExposurePanel } from "./CommercialExposurePanel";
import { NoticeDeadlineQueue } from "./NoticeDeadlineQueue";
import type { ChangeEvent, DailyReport } from "@/lib/d5o/types";

export function ChangeControlDashboard({
  events,
  dailyReports
}: {
  events: ChangeEvent[];
  dailyReports: DailyReport[];
}) {
  const activeEvents = events.filter((event) => !["billed", "closed"].includes(event.status));
  const noticeRisks = events.filter(
    (event) => event.noticeRequired && !["submitted", "waived"].includes(event.noticeStatus)
  );

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Change Event Register</p>
            <h2>Notice, backup, pricing, approval, and billing control</h2>
          </div>
          <span className="muted">{events.length} change events</span>
        </div>
        <ChangeEventTable events={events} />
      </section>

      <div className="content-grid">
        <ChangeControlScoreCard events={events} dailyReports={dailyReports} />
        <div className="project-stack">
          <NoticeDeadlineQueue events={events} />
          <ChangeBackupPanel events={events} />
          <CommercialExposurePanel events={events} />
        </div>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Notice and Recovery Focus</p>
            <h2>Events that can leak margin if not controlled</h2>
          </div>
          <span className="muted">{noticeRisks.length} notice risk(s)</span>
        </div>
        <div className="project-detail-grid">
          {activeEvents.map((event, index) => (
            <ChangeEventCard event={event} key={`change-card-${event.id}-${event.changeNumber}-${index}`} />
          ))}
        </div>
      </section>
    </>
  );
}
