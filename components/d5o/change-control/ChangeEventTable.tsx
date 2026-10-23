import {
  backupStatusLabels,
  backupStatusTone,
  changeStatusLabels,
  changeStatusTone,
  pricingStatusLabels,
  pricingStatusTone
} from "@/lib/d5o/change-control-config";
import { chipClass, currency, dateLabel } from "@/lib/d5o/presentation";
import type { ChangeEvent } from "@/lib/d5o/types";

export function ChangeEventTable({ events }: { events: ChangeEvent[] }) {
  return (
    <div className="table-wrap">
      <table className="opportunity-table">
        <thead>
          <tr>
            <th>Change</th>
            <th>Project</th>
            <th>Status</th>
            <th>Notice</th>
            <th>Backup</th>
            <th>Pricing</th>
            <th>Value</th>
            <th>Required action</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`change-table-${event.id}-${event.changeNumber}-${index}`}>
              <td><strong>{event.changeNumber}</strong><small>{event.title}</small></td>
              <td>{event.projectName}<small>{event.gcContact}</small></td>
              <td><span className={chipClass(changeStatusTone[event.status])}>{changeStatusLabels[event.status]}</span></td>
              <td>{event.noticeStatus}<small>{dateLabel(event.noticeDeadline)}</small></td>
              <td><span className={chipClass(backupStatusTone[event.backupStatus])}>{backupStatusLabels[event.backupStatus]}</span></td>
              <td><span className={chipClass(pricingStatusTone[event.pricingStatus])}>{pricingStatusLabels[event.pricingStatus]}</span></td>
              <td>{currency.format(event.costImpactEstimate)}<small>approved {currency.format(event.approvedAmount)}</small></td>
              <td>{event.requiredAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
