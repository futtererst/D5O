import { isDatabaseMode } from "./data-source";
import { insertSupabaseRow, readSupabaseTable, updateSupabaseRows } from "./database-client";
import { isDatabaseWorkflowTransactionStore } from "../workflow/transaction-store";
import { isProductionRuntime } from "../security/runtime-mode";
import {
  defaultWorkflowPersistenceContext,
  mapWorkflowToWorkflowInstanceInsert
} from "../workflow/persistence-adapter";
import type { OperatingWorkflow } from "../workflow/types";
import type { WorkflowTransactionInput, WorkflowTransactionResult } from "../workflow/transactions";

type WorkflowInstanceRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string | null;
  current_status: OperatingWorkflow["currentStatus"];
  resolution_state: OperatingWorkflow["resolutionState"];
  severity: OperatingWorkflow["severity"];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type WorkflowTransactionRow = {
  id: string;
  workflow_instance_id: string;
  created_at: string;
};

type AuditEventRow = {
  id: string;
  created_at: string;
};

type StatusHistoryRow = {
  id: string;
};

type WorkflowEvidenceRequirementRow = {
  id: string;
  title: string;
  status: string;
};

export type PersistWorkflowTransactionArgs = {
  workflow: OperatingWorkflow;
  result: WorkflowTransactionResult;
  actorUserId?: string | null;
};

export type PersistWorkflowTransactionResult = {
  mode: "database";
  transactionId: string;
  workflowInstanceId: string;
  auditEventId?: string;
  statusHistoryId?: string;
  evidenceRequirementIds: string[];
  updatedWorkflowInstance: WorkflowInstanceRow;
  successMessage: string;
};

export function canUseDatabaseWorkflowTransactionStore() {
  return isDatabaseMode() && isDatabaseWorkflowTransactionStore();
}

export async function persistWorkflowTransaction({
  workflow,
  result,
  actorUserId = null
}: PersistWorkflowTransactionArgs): Promise<PersistWorkflowTransactionResult> {
  if (isProductionRuntime()) {
    throw new Error("Generic workflow transaction persistence is unavailable in production until an atomic, server-authorized command replaces it.");
  }

  if (!canUseDatabaseWorkflowTransactionStore()) {
    throw new Error("Database workflow transaction store is not enabled. Use local transaction state or set both database modes explicitly.");
  }

  if (!result.success) {
    throw new Error(result.message);
  }

  const workflowInstance = await findOrCreateWorkflowInstance(workflow, actorUserId);
  const transactionRow = await insertSupabaseRow<WorkflowTransactionRow>("workflow_transactions", {
    organization_id: workflowInstance.organization_id,
    workspace_id: workflowInstance.workspace_id,
    project_id: workflowInstance.project_id,
    workflow_instance_id: workflowInstance.id,
    transaction_type: result.transactionType,
    transaction_label: result.label,
    actor_name: result.input.actorName,
    actor_role: result.input.actorRole,
    actor_user_id: actorUserId,
    decision: result.transactionType,
    decision_reason: result.input.decisionReason ?? null,
    action_taken: result.input.notes,
    evidence_summary: result.input.evidenceConfirmed.join("; "),
    resulting_status: result.outcome.currentStatus,
    resulting_resolution_state: result.outcome.resolutionState,
    resulting_gate_movement: result.outcome.nextGateOrStatus.label,
    success_message: result.message,
    metadata: {
      localTransactionId: result.id,
      sourceWorkflowId: workflow.id,
      nextRecommendedStep: result.nextRecommendedStep,
      targetHref: result.outcome.targetHref,
      evidenceConfirmed: result.input.evidenceConfirmed
    }
  });

  const [updatedWorkflowInstance] = await updateSupabaseRows<WorkflowInstanceRow>(
    "workflow_instances",
    { id: `eq.${workflowInstance.id}` },
    {
      current_status: result.outcome.currentStatus,
      resolution_state: result.outcome.resolutionState,
      severity: result.outcome.severity,
      next_gate_or_status: result.outcome.nextGateOrStatus.label,
      updated_by: actorUserId,
      updated_at: result.createdAt,
      metadata: {
        ...(workflowInstance.metadata ?? {}),
        lastTransactionId: transactionRow.id,
        localWorkflowId: workflow.id,
        lastTransactionType: result.transactionType,
        lastTransactionAt: result.createdAt
      }
    }
  );

  const auditRow = await insertSupabaseRow<AuditEventRow>("audit_events", {
    organization_id: workflowInstance.organization_id,
    workspace_id: workflowInstance.workspace_id,
    project_id: workflowInstance.project_id,
    entity_type: "workflow_instance",
    entity_id: workflowInstance.id,
    action: result.auditEvent.action,
    actor_role: result.input.actorRole,
    actor_name: result.input.actorName,
    actor_user_id: actorUserId,
    summary: result.auditEvent.summary,
    before_state: {
      currentStatus: workflowInstance.current_status,
      resolutionState: workflowInstance.resolution_state,
      severity: workflowInstance.severity
    },
    after_state: {
      currentStatus: result.outcome.currentStatus,
      resolutionState: result.outcome.resolutionState,
      severity: result.outcome.severity
    },
    severity: result.auditEvent.severity ?? "info",
    metadata: {
      workflowTransactionId: transactionRow.id,
      sourceModule: workflow.sourceModule,
      sourceRecordType: workflow.sourceRecordType,
      sourceRecordId: workflow.sourceRecordId
    },
    created_at: result.createdAt
  });

  const statusChanged =
    workflowInstance.current_status !== result.outcome.currentStatus ||
    workflowInstance.resolution_state !== result.outcome.resolutionState;
  const statusHistoryRow = statusChanged
    ? await insertSupabaseRow<StatusHistoryRow>("status_history", {
        organization_id: workflowInstance.organization_id,
        workspace_id: workflowInstance.workspace_id,
        project_id: workflowInstance.project_id,
        entity_type: "workflow_instance",
        entity_id: workflowInstance.id,
        from_status: `${workflowInstance.current_status}/${workflowInstance.resolution_state}`,
        to_status: `${result.outcome.currentStatus}/${result.outcome.resolutionState}`,
        changed_by: actorUserId,
        changed_at: result.createdAt,
        reason: result.input.decisionReason || result.input.notes,
        related_audit_event_id: auditRow.id,
        metadata: {
          workflowTransactionId: transactionRow.id,
          resultingGateMovement: result.outcome.nextGateOrStatus.label
        }
      })
    : undefined;

  const evidenceRequirementIds = await markEvidenceRequirementsVerified(
    workflowInstance.id,
    result.input.evidenceConfirmed,
    result.createdAt
  );

  return {
    mode: "database",
    transactionId: transactionRow.id,
    workflowInstanceId: workflowInstance.id,
    auditEventId: auditRow.id,
    statusHistoryId: statusHistoryRow?.id,
    evidenceRequirementIds,
    updatedWorkflowInstance: updatedWorkflowInstance ?? workflowInstance,
    successMessage: result.message
  };
}

async function findOrCreateWorkflowInstance(workflow: OperatingWorkflow, actorUserId: string | null) {
  const byId = isUuid(workflow.id)
    ? await readSupabaseTable<WorkflowInstanceRow>("workflow_instances", {
        filters: { id: `eq.${workflow.id}` },
        limit: 1
      })
    : [];

  if (byId[0]) {
    return byId[0];
  }

  const bySource = await readSupabaseTable<WorkflowInstanceRow>("workflow_instances", {
    filters: {
      source_module: `eq.${workflow.sourceModule}`,
      source_record_type: `eq.${workflow.sourceRecordType}`,
      source_record_id: `eq.${workflow.sourceRecordId}`
    },
    limit: 1
  });

  if (bySource[0]) {
    return bySource[0];
  }

  const insert = mapWorkflowToWorkflowInstanceInsert(workflow, defaultWorkflowPersistenceContext);
  const safeInsert = {
    ...insert,
    project_id: isUuid(workflow.projectId) ? workflow.projectId : null,
    created_by: actorUserId,
    updated_by: actorUserId,
    metadata: {
      ...(insert.metadata ?? {}),
      localWorkflowId: workflow.id,
      createdByPilot: true
    }
  };

  return insertSupabaseRow<WorkflowInstanceRow>("workflow_instances", safeInsert);
}

async function markEvidenceRequirementsVerified(
  workflowInstanceId: string,
  evidenceConfirmed: string[],
  timestamp: string
) {
  if (evidenceConfirmed.length === 0) {
    return [];
  }

  const requirements = await readSupabaseTable<WorkflowEvidenceRequirementRow>("workflow_evidence_requirements", {
    filters: { workflow_instance_id: `eq.${workflowInstanceId}` },
    limit: 100
  });
  const normalizedEvidence = new Set(evidenceConfirmed.map((item) => item.trim().toLowerCase()));
  const matchingRequirements = requirements.filter((requirement) =>
    normalizedEvidence.has(requirement.title.trim().toLowerCase())
  );

  const updated = await Promise.all(
    matchingRequirements.map((requirement) =>
      updateSupabaseRows<WorkflowEvidenceRequirementRow>(
        "workflow_evidence_requirements",
        { id: `eq.${requirement.id}` },
        {
          status: "verified",
          updated_at: timestamp
        }
      )
    )
  );

  return updated.flat().map((requirement) => requirement.id);
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
