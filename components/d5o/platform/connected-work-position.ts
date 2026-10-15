import type { WorkRecord } from "./work-types";
import { currentAcceptedRelease, currentWorkAcceptanceScope } from "./deploy-model";

export type ConnectedWorkPosition = { label: string; nextAction: string; value: string; warning?: string };

/** Read-only presentation of committed phase facts. It never changes the Work Record or grants authority. */
export function connectedWorkPosition(work: WorkRecord): ConnectedWorkPosition | null {
  if (!work.canonicalWorkId) return null;
  const estimate = work.discovery?.estimate;
  const currency = estimate?.detailed?.input.currency;
  const value = estimate?.status === "Approved" && Number.isFinite(estimate.sellPrice) && estimate.sellPrice > 0
    ? `${currency ?? "Currency unknown"} ${estimate.sellPrice.toFixed(2)} approved estimate`
    : "Approved price not recorded";
  const accepted = work.deploy?.workAcceptance;
  const scopeCurrent = currentWorkAcceptanceScope(work);
  if (accepted?.receipt === "Accepted" && !scopeCurrent)
    return { label: "Accepted prior scope · current scope changed", nextAction: "Reconcile current packages and releases under a separate governed Work Record", value,
      warning: "The retained customer and Operations decisions do not approve the current package set." };
  if (work.operate?.activation?.status === "Active" && accepted?.receipt === "Accepted" && scopeCurrent)
    return { label: "Operate · support active", nextAction: "Review support obligations and Finance separately", value };
  if (work.operate?.support && accepted?.receipt === "Accepted" && scopeCurrent)
    return { label: "Operate · support owner accepted", nextAction: "Assess operational activation", value };
  if (accepted?.receipt === "Accepted" && scopeCurrent)
    return { label: "Deploy · Operations receipt accepted",
      nextAction: work.operate?.assets.length || work.operate?.assetLinks?.some((link) => link.status === "Accepted")
        ? "Receive ongoing support responsibility in Operate"
        : "Identify or link a supported asset before accepting support responsibility", value };
  if (accepted && scopeCurrent)
    return { label: "Deploy · customer scope accepted", nextAction: "Obtain independent whole-work Operations receipt", value };
  const packages = work.packages ?? [];
  const currentReleases = packages.filter((pkg) => currentAcceptedRelease(work, pkg.id)).length;
  if (currentReleases)
    return { label: `Design · ${currentReleases} of ${packages.length} packages released and received`,
      nextAction: "Complete field work, verification and scoped acceptance for the current releases", value };
  if (work.discovery?.designHandoff?.status === "accepted")
    return { label: "Design · awarded basis received", nextAction: "Review and release exact Work Packages", value };
  if (work.discovery?.designHandoff?.status === "submitted")
    return { label: "Develop · Design receiving pending", nextAction: "Independent Design receiver must accept or return the submitted basis", value };
  if (work.discovery?.outcome === "Won")
    return { label: "Develop · fictional customer award recorded", nextAction: "Submit the awarded basis for Design receiving", value };
  if (work.discovery?.proposal.status === "Submitted")
    return { label: "Develop · customer offer submitted", nextAction: "Record the sourced customer outcome", value };
  if (work.discovery?.proposal.status === "Approved")
    return { label: "Develop · offer approved internally", nextAction: "Record customer submission of the exact offer", value };
  if (estimate?.status === "Approved")
    return { label: "Develop · pricing approved", nextAction: "Prepare and submit the customer offer", value };
  if (work.develop?.review?.status === "Approved")
    return { label: "Develop · solution approved", nextAction: "Prepare the detailed estimate", value };
  if (work.definition?.status === "Approved")
    return { label: "Define · baseline approved", nextAction: "Receive the approved basis into Develop", value };
  if (work.discovery?.pursuitControl?.status === "qualified")
    return { label: "Discover · pursuit qualified", nextAction: "Receive the exact Define handoff", value };
  return { label: "Discover · controlled intake", nextAction: "Review the current task in My Work", value };
}
/** Existing Rybex reference lanes, grouped from the same committed position. */
export function connectedLifecyclePosition(work: WorkRecord): number | null {
  if (!work.canonicalWorkId || work.workspace !== "rybex") return null;
  const position = connectedWorkPosition(work);
  if (!position) return null;
  if (position.warning) return 1; // Changed scope needs renewed readiness, not historical acceptance.
  if (position.label.startsWith("Operate") || position.label.startsWith("Deploy · customer scope accepted") ||
    position.label.startsWith("Deploy · Operations receipt accepted")) return 5;
  if (position.label.startsWith("Deploy")) return 2;
  if (position.label.startsWith("Design")) return 1;
  return 0;
}
