"use server";

import { getCurrentRybexUser, getDatabaseSafeActorUserId } from "@/lib/d5o/auth/current-user";
import { assertWorkflowTransactionPermission } from "@/lib/d5o/auth/permission-guard";
import { isDatabaseMode } from "@/lib/d5o/data/data-source";
import { persistWorkflowTransaction } from "@/lib/d5o/data/workflow-transaction-writes";
import { isProductionRuntime } from "@/lib/d5o/security/runtime-mode";
import { applyWorkflowTransaction } from "@/lib/d5o/workflow/apply-transaction";
import { isDatabaseWorkflowTransactionStore } from "@/lib/d5o/workflow/transaction-store";
import {
  getWorkflowTransactionDefinition,
  isWorkflowTransactionType,
  type WorkflowTransactionType
} from "@/lib/d5o/workflow/transactions";
import type { OperatingWorkflow } from "@/lib/d5o/workflow/types";

type CommitWorkflowTransactionInput = {
  workflow: OperatingWorkflow;
  transactionType: WorkflowTransactionType;
  input: {
    notes: string;
    decisionReason: string;
    owner: string;
    evidenceConfirmed: string[];
  };
};

export type CommitWorkflowTransactionResult = {
  success: boolean;
  mode: "local" | "database";
  message: string;
  nextRecommendedStep?: string;
  localResult?: ReturnType<typeof applyWorkflowTransaction>;
  databaseResult?: {
    transactionId: string;
    workflowInstanceId: string;
    auditEventId?: string;
    statusHistoryId?: string;
    evidenceRequirementIds: string[];
  };
  actor?: {
    name: string;
    role?: string;
    source: "demo" | "supabase";
  };
  permission?: {
    allowed: boolean;
    requiredPermissions: string[];
    message: string;
  };
};

export async function commitWorkflowTransaction(
  request: CommitWorkflowTransactionInput
): Promise<CommitWorkflowTransactionResult> {
  const validationError = validateRequest(request);

  if (validationError) {
    return {
      success: false,
      mode: "local",
      message: validationError
    };
  }

  // The legacy endpoint accepts a workflow snapshot from its caller. Its
  // database adapter does not provide an atomic, tenant-authorized command.
  if (isProductionRuntime()) {
    return {
      success: false,
      mode: "database",
      message: "Generic workflow transactions are unavailable in production until server-owned, atomic authorization is implemented."
    };
  }

  const timestamp = new Date().toISOString();
  const currentUser = await getCurrentRybexUser();
  const databaseStoreEnabled = isDatabaseMode() && isDatabaseWorkflowTransactionStore();

  if (!currentUser.authenticated || !currentUser.role) {
    return {
      success: false,
      mode: databaseStoreEnabled ? "database" : "local",
      message: currentUser.message,
      actor: {
        name: currentUser.name,
        role: currentUser.role,
        source: currentUser.source
      }
    };
  }

  let permission;

  try {
    permission = assertWorkflowTransactionPermission(
      request.transactionType,
      request.workflow.workflowType,
      currentUser.role
    );
  } catch (error) {
    return {
      success: false,
      mode: databaseStoreEnabled ? "database" : "local",
      message: error instanceof Error ? error.message : "Workflow transaction permission denied.",
      actor: {
        name: currentUser.name,
        role: currentUser.role,
        source: currentUser.source
      },
      permission: {
        allowed: false,
        requiredPermissions: [],
        message: error instanceof Error ? error.message : "Workflow transaction permission denied."
      }
    };
  }

  const localResult = applyWorkflowTransaction({
    workflow: request.workflow,
    transactionType: request.transactionType,
    input: request.input,
    actorName: currentUser.name,
    actorRole: currentUser.role,
    timestamp
  });

  if (!localResult.success) {
    return {
      success: false,
      mode: "local",
      message: localResult.message,
      localResult,
      actor: {
        name: currentUser.name,
        role: currentUser.role,
        source: currentUser.source
      },
      permission
    };
  }

  if (!databaseStoreEnabled) {
    return {
      success: true,
      mode: "local",
      message: "Local workflow transaction applied. Database transaction store is not enabled.",
      nextRecommendedStep: localResult.nextRecommendedStep,
      localResult,
      actor: {
        name: currentUser.name,
        role: currentUser.role,
        source: currentUser.source
      },
      permission
    };
  }

  try {
    const databaseResult = await persistWorkflowTransaction({
      workflow: request.workflow,
      result: localResult,
      actorUserId: getDatabaseSafeActorUserId(currentUser)
    });

    return {
      success: true,
      mode: "database",
      message: `${databaseResult.successMessage} Database workflow transaction written.`,
      nextRecommendedStep: localResult.nextRecommendedStep,
      localResult,
      actor: {
        name: currentUser.name,
        role: currentUser.role,
        source: currentUser.source
      },
      permission,
      databaseResult: {
        transactionId: databaseResult.transactionId,
        workflowInstanceId: databaseResult.workflowInstanceId,
        auditEventId: databaseResult.auditEventId,
        statusHistoryId: databaseResult.statusHistoryId,
        evidenceRequirementIds: databaseResult.evidenceRequirementIds
      }
    };
  } catch (error) {
    return {
      success: false,
      mode: "database",
      message: error instanceof Error ? error.message : "Database workflow transaction write failed.",
      localResult,
      actor: {
        name: currentUser.name,
        role: currentUser.role,
        source: currentUser.source
      },
      permission
    };
  }
}

function validateRequest(request: CommitWorkflowTransactionInput) {
  if (!request.workflow?.id) {
    return "Workflow transaction requires a workflow.";
  }

  if (!isWorkflowTransactionType(request.transactionType)) {
    return "Workflow transaction runtime authority is missing or invalid.";
  }

  if (!getWorkflowTransactionDefinition(request.transactionType, request.workflow.workflowType)) {
    return "Workflow transaction is not configured for this workflow type.";
  }

  if (!request.input?.notes?.trim()) {
    return "Workflow transaction requires notes.";
  }

  if (!Array.isArray(request.input.evidenceConfirmed)) {
    return "Workflow transaction requires an evidence checklist.";
  }

  return "";
}
