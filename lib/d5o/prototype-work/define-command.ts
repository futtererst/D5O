import type { DefinitionRecord, WorkRecord } from "@/components/d5o/platform/work-types";
import { assessDefine } from "@/components/d5o/platform/define-readiness";
import { evaluateRule } from "@/components/d5o/platform/phase-configuration";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import { PrototypeWorkError } from "./store-error";
import { sameJsonValue } from "./semantic-json";

export type DefineCommand = {
  action: "submit" | "approve-review" | "return-review" | "submit-handoff" |
    "accept-handoff" | "return-handoff" | "new-revision";
  workId: string; expectedRevision: number; commandId: string;
  expectedDecisionRevision?: number;
  role?: "commercial" | "delivery"; reason?: string;
};
export type DefineActor = { id: string; membershipId: string; name: string; role: string };
type Decision = NonNullable<DefinitionRecord["decisions"]>[number];
const managers = new Set(["admin", "project_manager", "operations_leader"]);
const commercial = new Set(["admin", "billing_commercial_lead"]);
const delivery = new Set(["admin", "operations_leader", "project_manager"]);
function fail(code: string, message: string, status = 409): never { throw new PrototypeWorkError(code, status, message); }
export const defineCommandFingerprint = (command: DefineCommand) => JSON.stringify(Object.entries(command).sort(([a], [b]) => a.localeCompare(b)));

export function applyDefineCommand(work: WorkRecord, command: DefineCommand, actor: DefineActor, inventory: ConfigurationInventory): WorkRecord {
  const definition = work.definition ? structuredClone(work.definition) : undefined;
  if (!definition) throw new PrototypeWorkError("definition_unavailable", 400, "Save a Define draft before deciding.");
  if (!actor.id || !actor.membershipId || !command.commandId || command.commandId.length > 100)
    fail("definition_unavailable", "Use an authenticated membership and unique command before deciding.", 400);
  const decisions = definition.decisions ?? [];
  const prior = decisions.find((item) => item.commandId === command.commandId);
  if (prior) {
    if (prior.actorId !== actor.id || prior.membershipId !== actor.membershipId || prior.fingerprint !== defineCommandFingerprint(command))
      fail("command_reuse_conflict", "This Define command ID belongs to another decision.");
    return work;
  }
  const config = resolvePublishedPhaseConfiguration(inventory, work.workspace, work.type, work);
  if (!config || !work.phaseConfigurationVersionId) fail("configuration_unavailable", "The exact pinned Define policy is unavailable.");
  const phase = config.phases.find((item) => item.key === "define");
  if (!phase) fail("configuration_unavailable", "The pinned Define phase is unavailable.");
  const required = phase.components.flatMap((item) => item.rules ?? []).filter((item) => item.requiredAt === "review");
  const missing = required.filter((item) => !evaluateRule(work, item)).map((item) => item.message);
  const verdict = assessDefine(work, definition, config.version, missing);
  const needsCommercial = phase.components.some((item) => item.key === "commercial_source");
  const reason = command.reason?.trim() ?? "";
  const now = new Date().toISOString();
  const submitter = [...decisions].reverse().find((item) => item.action === "submit" && item.definitionRevision === definition.revision);
  const reviewer = (role: "commercial" | "delivery") => decisions.find((item) => item.definitionRevision === definition.revision && item.action === "approve-review" && item.reviewRole === role);
  let nextAction = work.nextAction;
  if (command.action === "submit") {
    if (!managers.has(actor.role)) fail("define_role_denied", "A Define owner is required.", 403);
    if (definition.status !== "Draft" || verdict.status !== "Ready for review" || missing.length)
      fail("definition_incomplete", verdict.next?.detail ?? missing[0] ?? "The Define basis is incomplete.");
    definition.status = "In review";
    definition.reviews = { commercial: "Pending", delivery: "Pending", revision: definition.revision };
    definition.configurationVersion = config.version;
    definition.configurationWorkTypeKey = config.workTypeKey;
    definition.sourceEstimateRevision = needsCommercial ? work.discovery?.estimate.revision : undefined;
    definition.sourceProposalRevision = needsCommercial ? work.discovery?.proposal.package?.revision : undefined;
    nextAction = "Commercial and Delivery: review the Define baseline";
  } else if (command.action === "approve-review" || command.action === "return-review") {
    const role = command.role;
    if (!role || !(role === "commercial" ? commercial : delivery).has(actor.role)) fail("define_review_role_denied", "The assigned specialist review role is required.", 403);
    if (definition.status !== "In review" || definition.reviews?.revision !== definition.revision || definition.reviews[role] !== "Pending" || !submitter)
      fail("define_review_unavailable", "A current server-submitted Define revision is required.");
    if (submitter.actorId === actor.id || reviewer(role === "commercial" ? "delivery" : "commercial")?.actorId === actor.id)
      fail("define_separation_required", "Submission and specialist decisions require independent actors.", 403);
    if (reason.length < 10) fail("decision_reason_required", "Record a specific review reason.", 400);
    if (command.action === "approve-review" && (verdict.status !== "Ready for review" || missing.length))
      fail("definition_incomplete", verdict.next?.detail ?? missing[0] ?? "The Define basis changed.");
    definition.reviews[role] = command.action === "approve-review" ? "Approved" : "Changes requested";
    definition.status = command.action === "return-review" ? "Changes requested" :
      definition.reviews.commercial === "Approved" && definition.reviews.delivery === "Approved" ? "Approved" : "In review";
    if (definition.status === "Approved") {
      definition.approvedBaselines = [...(definition.approvedBaselines ?? []), {
        revision: definition.revision, approvedAt: now, configurationVersion: config.version,
        outcome: definition.outcome, excludedScope: definition.excludedScope, deliveryApproach: definition.deliveryApproach,
        registers: structuredClone(definition.registers ?? {}), project: definition.project ? structuredClone(definition.project) : undefined,
        findings: structuredClone(definition.findings ?? []), clarifications: structuredClone(definition.clarifications ?? []),
        scopeControl: definition.scopeControl ? structuredClone(definition.scopeControl) : undefined
      }];
      nextAction = "Define owner: submit the approved baseline to Develop";
    } else if (definition.status === "Changes requested") nextAction = "Define owner: correct the returned revision";
  } else if (command.action === "submit-handoff") {
    if (!managers.has(actor.role) || definition.status !== "Approved" || !definition.approvedBaselines?.some((item) => item.revision === definition.revision))
      fail("define_handoff_unavailable", "An approved exact Define baseline is required.");
    if (definition.developHandoff?.status === "submitted" || definition.developHandoff?.status === "accepted") fail("define_handoff_exists", "This revision has already been sent.");
    definition.developHandoff = { revision: definition.revision, status: "submitted", receiver: "Develop receiver queue", note: reason || "Approved Define basis submitted", submittedAt: now, actor: actor.name, submittedByActorId: actor.id, submittedByMembershipId: actor.membershipId };
    nextAction = "Develop receiver: accept or return the exact Define revision";
  } else if (command.action === "accept-handoff" || command.action === "return-handoff") {
    if (!delivery.has(actor.role) || definition.status !== "Approved" || definition.developHandoff?.status !== "submitted" || definition.developHandoff.revision !== definition.revision)
      fail("define_receipt_unavailable", "A current approved Define handoff is required.");
    if ((definition.developHandoff.submittedByActorId ?? submitter?.actorId) === actor.id)
      fail("define_separation_required", "The receiving actor must differ from the handoff sender.", 403);
    if (reason.length < 10) fail("decision_reason_required", "Record the receiving decision basis.", 400);
    definition.developHandoff = { ...definition.developHandoff, status: command.action === "accept-handoff" ? "accepted" : "returned", note: reason, respondedAt: now, receivedByActorId: actor.id, receivedByMembershipId: actor.membershipId };
    nextAction = command.action === "accept-handoff" ? "Develop owner: develop the solution and estimate" : "Define owner: revise the returned basis";
  } else if (command.action === "new-revision") {
    if (!managers.has(actor.role) || !["Changes requested", "Approved"].includes(definition.status) || definition.developHandoff?.status === "accepted")
      fail("revision_unavailable", "Only a returned or unreceived approved baseline can be revised.");
    if (reason.length < 10) fail("decision_reason_required", "Record why this baseline needs revision.", 400);
    definition.revision++;
    definition.status = "Draft";
    definition.reviews = undefined;
    definition.developHandoff = undefined;
    nextAction = "Define owner: correct and resubmit the new revision";
  } else fail("invalid_command", "Unknown Define command.", 400);
  const decision: Decision = { commandId: command.commandId, fingerprint: defineCommandFingerprint(command), action: command.action,
    definitionRevision: definition.revision, reviewRole: command.role, actorId: actor.id, membershipId: actor.membershipId,
    policyVersion: config.version, at: now, reason };
  definition.decisions = [...decisions, decision];
  definition.history = [...definition.history, { at: now, revision: definition.revision, event: command.action, note: `${actor.name} (${actor.id}; ${actor.membershipId}) · ${reason || "Decision recorded"}` }];
  return { ...work, definition, nextAction, history: [`${now} · Define ${command.action} revision ${definition.revision} by ${actor.name}`, ...work.history] };
}

export function assertSnapshotDefineIntegrity(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const next = new Map(after.map((item) => [item.id, item as WorkRecord]));
  const protectedFields = (definition?: DefinitionRecord) => ({
    revision: definition?.revision, status: definition?.status, reviews: definition?.reviews,
    baselines: definition?.approvedBaselines, receipt: definition?.developHandoff,
    decisions: definition?.decisions
  });
  for (const item of before) {
    const prior = item as WorkRecord, current = next.get(prior.id);
    if (!current && prior.definition) fail("protected_definition_deleted", "A Work Record with a Define basis cannot be removed through a snapshot.");
    if (current && !prior.definition && current.definition?.status === "Draft" && current.definition.revision === 1
      && !current.definition.decisions?.length && !current.definition.reviews && !current.definition.developHandoff) continue;
    if (current && !sameJsonValue(protectedFields(prior.definition), protectedFields(current.definition)))
      fail("protected_definition_changed", "Define decisions and revisions require an authenticated server command.");
    if (current && prior.definition && prior.definition.status !== "Draft"
      && !sameJsonValue(prior.definition, current.definition))
      fail("protected_definition_changed", "A submitted or approved Define revision cannot be edited through a draft snapshot.");
  }
  for (const item of after) if (!before.some((prior) => prior.id === item.id)) {
    const definition = (item as WorkRecord).definition;
    if (definition && (definition.status !== "Draft" || definition.reviews || definition.approvedBaselines?.length || definition.developHandoff || definition.decisions?.length))
      fail("protected_definition_import", "A new Work Record cannot import Define decisions.");
  }
}
