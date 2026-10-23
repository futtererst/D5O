import { currency } from "@/lib/d5o/presentation";
import type { ChangeEvent } from "@/lib/d5o/types";

export function ApprovedNotBilledQueue({ changeEvents }: { changeEvents: ChangeEvent[] }) {
  const items = changeEvents.filter((event) => event.billingStatus === "approved_not_billed");

  return (
    <section className="control-list">
      <h3>Approved Not Billed</h3>
      {items.length > 0 ? (
        <ul className="compact-list">
          {items.map((event, index) => (
            <li key={`approved-not-billed-${event.id}-${event.changeNumber}-${index}`}>
              <span className="artifact-state artifact-missing" />
              <span>
                <strong>{event.changeNumber}: {event.title}</strong>
                <small className="muted">{event.projectName} | {currency.format(event.approvedAmount)}</small>
                <p>{event.requiredAction}</p>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No approved changes are waiting to be billed.</p>
      )}
    </section>
  );
}
