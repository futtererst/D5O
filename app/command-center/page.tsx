import Link from "next/link";
import { CollapsedDetails } from "@/components/d5o/end-user";
import { applyBillingV2CompletionToWorkspaceSummary } from "@/lib/d5o/billing-v2/app-state";
import {
  getBillingV2ActionState,
  getBillingV2SeedDataOverlay
} from "@/lib/d5o/billing-v2/store";
import { applyFieldIssueEscalationToWorkspaceSummary } from "@/lib/d5o/field-issue-escalation/app-state";
import {
  getFieldIssueActionState,
  getFieldIssueSeedDataOverlay
} from "@/lib/d5o/field-issue-escalation/store";
import { applyCloseoutFinalBillingToWorkspaceSummary } from "@/lib/d5o/closeout-final-billing/app-state";
import {
  applyCloseoutFinalBillingToSeedData,
  getCloseoutFinalBillingActionState
} from "@/lib/d5o/closeout-final-billing/store";
import { evaluateBillingControl } from "@/lib/d5o/billing-control";
import { evaluateChangeControl } from "@/lib/d5o/change-control";
import { evaluateRfiSubmittalControl } from "@/lib/d5o/rfi-submittal-control";
import {
  changeEvents,
  acceptanceRecords,
  closeoutPackages,
  closeoutRequirements,
  dailyReports,
  lienWaivers,
  rfis,
  submittals
} from "@/lib/d5o/seed-data";
import { currency, dateLabel } from "@/lib/d5o/presentation";
import { deriveOperatingWorkflows } from "@/lib/d5o/workflow";
import { getEndUserWorkspaceSummary } from "@/lib/d5o/end-user/page-focus-config";

const operatingDate = "2026-06-10";

export const dynamic = "force-dynamic";

const rfiSubmittalControl = evaluateRfiSubmittalControl({ rfis, submittals });
const changeControl = evaluateChangeControl({ changeEvents, dailyReports });
const missingDailyReports = dailyReports.filter((report) =>
  ["missing", "late"].includes(report.reportStatus)
);
const fieldExecutionSignals = dailyReports.filter(
  (report) =>
    report.blockers.length > 0 ||
    report.delays.length > 0 ||
    report.rfiNeeded ||
    report.changeEventNeeded ||
    report.productionStatus === "blocked" ||
    report.productionStatus === "behind"
);
const overdueRfIs = rfis.filter((rfi) => rfi.status === "overdue" || rfi.dueDate < operatingDate);
const overdueSubmittals = submittals.filter(
  (submittal) =>
    submittal.status === "revise_and_resubmit" ||
    submittal.status === "rejected" ||
    submittal.status === "overdue" ||
    submittal.dueDate < operatingDate
);

export default async function CommandCenterPage() {
  const billingV2State = await getBillingV2ActionState();
  const billingOverlay = await getBillingV2SeedDataOverlay();
  const fieldIssueState = await getFieldIssueActionState();
  const fieldIssueOverlay = await getFieldIssueSeedDataOverlay();
  const closeoutFinalBillingState = await getCloseoutFinalBillingActionState();
  const closeoutFinalBillingOverlay = applyCloseoutFinalBillingToSeedData(closeoutFinalBillingState.blocker, {
    payApplications: billingOverlay.payApplications,
    lienWaivers,
    commercialExposureItems: billingOverlay.commercialExposureItems,
    closeoutPackages,
    closeoutRequirements,
    acceptanceRecords
  });
  const billingControl = evaluateBillingControl({
    payApplications: closeoutFinalBillingOverlay.payApplications,
    backupItems: billingOverlay.billingBackupItems,
    lienWaivers: closeoutFinalBillingOverlay.lienWaivers,
    commercialExposure: closeoutFinalBillingOverlay.commercialExposureItems,
    changeEvents
  });
  const workflowSummary = deriveOperatingWorkflows({
    ...billingOverlay,
    ...fieldIssueOverlay,
    ...closeoutFinalBillingOverlay
  });
  const commandCenterActionSummary = applyCloseoutFinalBillingToWorkspaceSummary(
    applyFieldIssueEscalationToWorkspaceSummary(
      applyBillingV2CompletionToWorkspaceSummary(
        getEndUserWorkspaceSummary("command-center"),
        billingV2State.package
      ),
      fieldIssueState.issue
    ),
    closeoutFinalBillingState.blocker
  );
  void workflowSummary;
  void commandCenterActionSummary;
  const triageItems = buildCommandCenterTriage({
    billingV2State,
    fieldIssueState,
    closeoutFinalBillingState
  });
  const unresolvedTriageItems = triageItems.filter((item) => !item.isResolved);
  const topPriority = unresolvedTriageItems[0];
  const supportingBlockers = unresolvedTriageItems.filter((_, index) => index > 0 && index < 3);
  const resolvedTriageItems = triageItems.filter((item) => item.isResolved);
  const activeExposure = unresolvedTriageItems.reduce((total, item) => total + item.exposureValue, 0);
  const blockerCopy =
    unresolvedTriageItems.length === 1
      ? "1 operating blocker requires action today"
      : `${unresolvedTriageItems.length} operating blockers require action today`;
  const supportSections = buildCommandCenterSupportingContext({
    billingControl,
    fieldIssueState,
    closeoutFinalBillingState,
    resolvedTriageItems,
    unresolvedTriageItems
  });

  return (
    <div className="command-grid command-center-page">
      <section className="command-c-plus-shell" data-qa="command-center-visual-triage">
      <div className="command-c-plus" data-qa="command-center-c-plus-action-queue">
        <section className="command-c-plus-hero" data-qa="command-center-executive-framing">
          <div>
            <p className="eyebrow">Command Center</p>
            <h1>{blockerCopy} to protect cash, schedule, and closeout.</h1>
            <p>
              See the blockers that need action now, ranked by cash, schedule, and closeout impact. Start with the highest-impact action.
            </p>
            {topPriority ? (
              <p className="command-c-plus-lead">
                First action: {topPriority.ctaLabel}. {topPriority.impactLabel}.
              </p>
            ) : null}
            <p className="command-c-plus-lead">
              Internal guided demo: <Link href="/pilot">Open Pilot Mode</Link>.
            </p>
          </div>
          <dl className="command-c-plus-summary" aria-label="Operating queue summary">
            <div>
              <dt>Active blockers</dt>
              <dd>{unresolvedTriageItems.length}</dd>
            </div>
            <div>
              <dt>Exposure in view</dt>
              <dd>{currency.format(activeExposure)}</dd>
            </div>
            <div>
              <dt>Top priority</dt>
              <dd>{topPriority?.ctaLabel ?? "No blocker open"}</dd>
            </div>
          </dl>
        </section>

        {topPriority ? (
          <section className="command-action-queue" aria-label="Ranked operating action queue">
            <div className="command-action-queue-labels" aria-hidden="true">
              <span>Rank</span>
              <span>Blocker</span>
              <span>Impact</span>
              <span>Next step</span>
              <span>Owner / role</span>
              <span>Action</span>
            </div>
            <article className="command-action-primary" data-qa="command-center-rank-1-action">
              <div className="command-action-rank" aria-label="Rank 1">1</div>
              <div className="command-action-main">
                <p className="eyebrow">Highest impact action</p>
                <h2>{topPriority.ctaLabel}</h2>
                <p>{topPriority.consequence}</p>
                <p className="command-mobile-priority-summary">
                  {topPriority.impactLabel}. Next: {topPriority.nextStep}
                </p>
              </div>
              <dl className="command-action-meta">
                <div>
                  <dt>Impact</dt>
                  <dd>{topPriority.impactLabel}</dd>
                </div>
                <div>
                  <dt>Next step</dt>
                  <dd>{topPriority.nextStep}</dd>
                </div>
                <div>
                  <dt>Owner / role</dt>
                  <dd>{topPriority.ownerRole}</dd>
                </div>
              </dl>
              <Link className="button button-primary command-action-primary-cta" href={topPriority.href}>
                {topPriority.ctaLabel}
              </Link>
            </article>

            {supportingBlockers.length > 0 ? (
              <div className="command-action-supporting-list" data-qa="command-center-supporting-actions">
                {supportingBlockers.map((item, index) => (
                  <article className="command-action-supporting-row" data-qa="command-center-supporting-action" key={item.id}>
                    <div className="command-action-rank command-action-rank-subordinate" aria-label={`Rank ${index + 2}`}>
                      {index + 2}
                    </div>
                    <div className="command-action-row-title">
                      <h3>{item.ctaLabel}</h3>
                      <p>{item.consequence}</p>
                    </div>
                    <dl className="command-action-row-meta">
                      <div>
                        <dt>Impact</dt>
                        <dd>{item.impactLabel}</dd>
                      </div>
                      <div>
                        <dt>Next step</dt>
                        <dd>{item.nextStep}</dd>
                      </div>
                      <div>
                        <dt>Owner / role</dt>
                        <dd>{item.ownerRole}</dd>
                      </div>
                    </dl>
                    <Link className="button command-action-row-cta" href={item.href}>
                      {item.ctaLabel}
                    </Link>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="command-action-primary command-action-primary-resolved" data-qa="command-center-rank-1-action">
            <div className="command-action-rank" aria-label="Resolved">0</div>
            <div>
              <p className="eyebrow">Action queue clear</p>
            <h3>No operating blockers open</h3>
              <p>The three core workbenches are clear. Review supporting operating context below.</p>
            </div>
          </section>
        )}
      </div>
      </section>

      {supportSections.length > 0 ? (
        <CollapsedDetails
          title="Supporting context"
          summary="Reference only. Recently resolved items, watch-list items, and background health signals. The ranked actions above are the current priorities."
        >
          <div className="command-supporting-context" data-qa="command-center-supporting-context">
            {supportSections.map((section) => (
              <section
                className="command-supporting-context-section"
                data-qa="command-center-supporting-context-section"
                data-section={section.title}
                key={section.title}
              >
                <h2>{section.title}</h2>
                <ul className="command-supporting-context-list">
                  {section.items.map((item) => (
                    <li className="command-supporting-context-row" key={item.id}>
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                      {item.href ? <Link href={item.href}>{item.linkLabel ?? "Open module"}</Link> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </CollapsedDetails>
      ) : null}
    </div>
  );
}

type CommandCenterTriageState = {
  billingV2State: Awaited<ReturnType<typeof getBillingV2ActionState>>;
  fieldIssueState: Awaited<ReturnType<typeof getFieldIssueActionState>>;
  closeoutFinalBillingState: Awaited<ReturnType<typeof getCloseoutFinalBillingActionState>>;
};

type CommandCenterSupportItem = {
  id: string;
  label: string;
  detail: string;
  href?: string;
  linkLabel?: string;
};

type CommandCenterSupportSection = {
  title: "Recently resolved" | "Watch list" | "Lower-priority alerts" | "Health signals";
  items: CommandCenterSupportItem[];
};

type CommandCenterTriageItem = {
  id: string;
  title: string;
  consequence: string;
  impactLabel: string;
  exposureValue: number;
  statusLabel: string;
  nextStep: string;
  ownerRole: string;
  destination: string;
  href: string;
  ctaLabel: string;
  resolvedSummary: string;
  isResolved: boolean;
  priority: number;
};

type CommandCenterSupportState = {
  billingControl: ReturnType<typeof evaluateBillingControl>;
  fieldIssueState: Awaited<ReturnType<typeof getFieldIssueActionState>>;
  closeoutFinalBillingState: Awaited<ReturnType<typeof getCloseoutFinalBillingActionState>>;
  resolvedTriageItems: CommandCenterTriageItem[];
  unresolvedTriageItems: CommandCenterTriageItem[];
};
function buildCommandCenterTriage({
  billingV2State,
  fieldIssueState,
  closeoutFinalBillingState
}: CommandCenterTriageState): CommandCenterTriageItem[] {
  const billingPackage = billingV2State.package;
  const fieldIssue = fieldIssueState.issue;
  const closeoutBlocker = closeoutFinalBillingState.blocker;
  const fieldScheduleImpact = fieldIssue.scheduleImpact ? "Schedule impact open" : "No schedule impact confirmed";
  const fieldImpact = `${currency.format(fieldIssue.costExposure)} exposure · ${fieldScheduleImpact}`;

  return [
    {
      id: billingPackage.id,
      title: "Billing backup blocker",
      consequence: "Cash cannot move cleanly through review until backup evidence and approval are complete.",
      impactLabel: `${currency.format(billingPackage.blockedAmount)} cash at risk`,
      exposureValue: billingPackage.state === "billing_blocker_cleared" ? 0 : billingPackage.blockedAmount,
      statusLabel: billingStatusLabel(billingPackage.state),
      nextStep: billingNextStep(billingV2State),
      ownerRole: "Billing Lead",
      destination: "Billing workbench",
      href: "/billing",
      ctaLabel: "Recover blocked billing",
      resolvedSummary: "Cash blocker cleared and billing readiness updated.",
      isResolved: billingPackage.state === "billing_blocker_cleared",
      priority: 30
    },
    {
      id: fieldIssue.id,
      title: "Field issue escalation",
      consequence: "The field condition needs the right RFI or change path before it affects schedule or margin.",
      impactLabel: fieldImpact,
      exposureValue: fieldIssue.state === "resolved" ? 0 : fieldIssue.costExposure,
      statusLabel: fieldStatusLabel(fieldIssue.state),
      nextStep: fieldNextStep(fieldIssueState),
      ownerRole: "Project Manager",
      destination: "Field Execution workbench",
      href: "/field-execution",
      ctaLabel: "Escalate field issue",
      resolvedSummary: "Original field issue resolved and downstream record created.",
      isResolved: fieldIssue.state === "resolved",
      priority: 20
    },
    {
      id: closeoutBlocker.id,
      title: "Final billing release blocker",
      consequence: "Final billing and retainage stay blocked until acceptance, evidence, and approval gaps are cleared.",
      impactLabel: `${currency.format(closeoutBlocker.retainageExposureAmount)} final billing / retainage at risk`,
      exposureValue: closeoutBlocker.state === "resolved" ? 0 : closeoutBlocker.retainageExposureAmount,
      statusLabel: closeoutStatusLabel(closeoutBlocker.state),
      nextStep: closeoutNextStep(closeoutFinalBillingState),
      ownerRole: "Closeout Lead",
      destination: "Closeout workbench",
      href: "/closeout",
      ctaLabel: "Release final billing",
      resolvedSummary: "Final billing and retainage released, with Billing updated.",
      isResolved: closeoutBlocker.state === "resolved",
      priority: 10
    }
  ].sort((left, right) => {
    if (left.isResolved !== right.isResolved) return left.isResolved ? 1 : -1;
    if (left.priority !== right.priority) return right.priority - left.priority;
    return right.exposureValue - left.exposureValue;
  });
}

function buildCommandCenterSupportingContext({
  billingControl,
  fieldIssueState,
  closeoutFinalBillingState,
  resolvedTriageItems,
  unresolvedTriageItems
}: CommandCenterSupportState): CommandCenterSupportSection[] {
  const sections: CommandCenterSupportSection[] = [];
  const recentlyResolved = resolvedTriageItems.slice(0, 3).map((item) => ({
    id: `resolved-${item.id}`,
    label: resolvedSupportLabel(item),
    detail: item.resolvedSummary,
    href: item.href,
    linkLabel: "View workbench"
  }));

  const watchList: CommandCenterSupportItem[] = [
    ...rfiSubmittalControl.scheduleCriticalItems.slice(0, 1).map((rfi) => ({
      id: `watch-rfi-${rfi.id}`,
      label: `${rfi.rfiNumber}: response watch`,
      detail: `${rfi.projectName} needs response by ${dateLabel(rfi.dueDate)} before crew sequence or entitlement is affected.`,
      href: "/rfis-submittals",
      linkLabel: "RFIs/Submittals"
    })),
    ...changeControl.noticeDeadlineRisks.slice(0, 1).map((change) => ({
      id: `watch-change-${change.id}`,
      label: `${change.changeNumber}: notice window`,
      detail: `${change.projectName} needs notice/backup movement before entitlement risk increases.`,
      href: "/changes",
      linkLabel: "Changes"
    })),
    ...billingControl.agingPayApplications.slice(0, 1).map((payApplication) => ({
      id: `watch-billing-${payApplication.id}`,
      label: `${payApplication.payApplicationNumber}: pay application aging`,
      detail: `${payApplication.projectName} should be escalated if payment is still open by ${dateLabel(payApplication.paymentDueDate)}.`,
      href: "/billing",
      linkLabel: "Billing"
    }))
  ].slice(0, 3);

  const lowerPriorityAlerts: CommandCenterSupportItem[] = [
    ...overdueRfIs.slice(0, 1).map((rfi) => ({
      id: `alert-rfi-${rfi.id}`,
      label: `${rfi.rfiNumber}: RFI response aging`,
      detail: `${rfi.projectName} needs follow-up if no GC response by ${dateLabel(rfi.dueDate)}.`,
      href: "/rfis-submittals",
      linkLabel: "RFIs/Submittals"
    })),
    ...overdueSubmittals.slice(0, 1).map((submittal) => ({
      id: `alert-submittal-${submittal.id}`,
      label: `${submittal.submittalNumber}: submittal review aging`,
      detail: `${submittal.projectName} needs follow-up before review delay affects field work.`,
      href: "/rfis-submittals",
      linkLabel: "RFIs/Submittals"
    })),
    ...missingDailyReports.slice(0, 1).map((report) => ({
      id: `alert-report-${report.id}`,
      label: "Daily report missing",
      detail: `${report.workPackageName} needs field documentation before schedule or commercial facts get stale.`,
      href: "/field-execution",
      linkLabel: "Field Execution"
    }))
  ].slice(0, 3);

  const healthSignalCandidates: Array<CommandCenterSupportItem | null> = [
    unresolvedTriageItems.some((item) => item.href === "/billing")
      ? {
          id: "health-cash-exposure",
          label: "Cash exposure remains the highest operating risk",
          detail: `${currency.format(billingControl.cashAtRisk)} remains exposed through billing support and review gaps.`,
          href: "/billing",
          linkLabel: "Billing"
        }
      : null,
    fieldIssueState.issue.state !== "resolved"
      ? {
          id: "health-field-entitlement",
          label: "One field issue may affect schedule or entitlement",
          detail: "The field issue needs evidence and the right RFI or change path before the record gets stale.",
          href: "/field-execution",
          linkLabel: "Field Execution"
        }
      : null,
    closeoutFinalBillingState.blocker.state !== "resolved"
      ? {
          id: "health-closeout-release",
          label: "One closeout item is blocking final billing release",
          detail: `${currency.format(closeoutFinalBillingState.blocker.retainageExposureAmount)} remains tied to acceptance, evidence, and approval gaps.`,
          href: "/closeout",
          linkLabel: "Closeout"
      }
      : null
  ];
  const healthSignals = healthSignalCandidates
    .filter((item): item is CommandCenterSupportItem => Boolean(item))
    .slice(0, 3);

  appendSupportSection(sections, "Recently resolved", recentlyResolved);
  appendSupportSection(sections, "Watch list", watchList);
  appendSupportSection(sections, "Lower-priority alerts", lowerPriorityAlerts);
  appendSupportSection(sections, "Health signals", healthSignals);

  return sections;
}

function appendSupportSection(
  sections: CommandCenterSupportSection[],
  title: CommandCenterSupportSection["title"],
  items: CommandCenterSupportItem[]
) {
  const visibleItems = items.filter(Boolean).slice(0, 3);

  if (visibleItems.length > 0) {
    sections.push({ title, items: visibleItems });
  }
}

function resolvedSupportLabel(item: CommandCenterTriageItem) {
  if (item.href === "/billing") return "Billing blocker cleared";
  if (item.href === "/field-execution") return "Field issue escalated";
  if (item.href === "/closeout") return "Final billing released";
  return item.ctaLabel;
}

function billingNextStep({ package: billingPackage, readiness }: CommandCenterTriageState["billingV2State"]) {
  if (billingPackage.state === "billing_blocker_cleared") return "Cash blocker cleared.";
  if (readiness.missingItems.length > 0) return "Add required backup evidence before review.";
  if (billingPackage.state === "package_ready_for_review") return "Send the backup package for commercial review.";
  if (billingPackage.state === "commercial_review_pending") return "Record the review decision.";
  if (billingPackage.state === "commercial_review_approved") return "Clear the cash blocker.";
  return "Start the backup package and confirm the billing details.";
}

function fieldNextStep({ issue, readiness }: CommandCenterTriageState["fieldIssueState"]) {
  if (issue.state === "resolved") return "Original field issue resolved.";
  if (!readiness.assessmentComplete) return "Assess schedule and commercial impact.";
  if (!readiness.evidenceComplete) return "Add evidence reference from the field.";
  if (!readiness.escalationPathSelected) return "Choose RFI or change event path.";
  if (!readiness.downstreamRecordCreated) return `Create the ${issue.selectedEscalationPath === "change_event" ? "change event" : "RFI"}.`;
  return "Resolve the original field issue.";
}

function closeoutNextStep({ blocker, readiness }: CommandCenterTriageState["closeoutFinalBillingState"]) {
  if (blocker.state === "resolved") return "Final billing blocker cleared.";
  if (!readiness.assessmentComplete) return "Assess acceptance and closeout requirements.";
  if (!readiness.evidenceComplete) return "Add required closeout evidence.";
  if (!readiness.readyForReview) return "Validate release readiness.";
  if (blocker.state === "review_pending") return "Record the review decision.";
  if (!readiness.approvedForRelease) return "Submit the release package for approval.";
  return "Clear the final billing blocker.";
}

function billingStatusLabel(state: CommandCenterTriageState["billingV2State"]["package"]["state"]) {
  const labels: Record<typeof state, string> = {
    blocked: "Blocked",
    backup_package_in_progress: "Backup in progress",
    evidence_required: "Evidence needed",
    package_ready_for_review: "Ready for review",
    commercial_review_pending: "Review pending",
    commercial_review_approved: "Approved",
    commercial_review_changes_requested: "Changes requested",
    commercial_review_rejected: "Rejected",
    billing_blocker_cleared: "Recovered",
    reopened: "Reopened"
  };

  return labels[state];
}

function fieldStatusLabel(state: CommandCenterTriageState["fieldIssueState"]["issue"]["state"]) {
  const labels: Record<typeof state, string> = {
    unresolved: "Needs escalation",
    in_progress: "Escalation started",
    assessed: "Impact assessed",
    evidence_added: "Evidence added",
    path_selected: "Path selected",
    downstream_created: "Record created",
    resolved: "Resolved"
  };

  return labels[state];
}

function closeoutStatusLabel(state: CommandCenterTriageState["closeoutFinalBillingState"]["blocker"]["state"]) {
  const labels: Record<typeof state, string> = {
    unresolved: "Blocked",
    in_progress: "Started",
    assessed: "Requirements assessed",
    evidence_added: "Evidence added",
    ready_for_review: "Ready for review",
    review_pending: "Review pending",
    approved: "Approved",
    rejected: "Rejected",
    resolved: "Released"
  };

  return labels[state];
}
