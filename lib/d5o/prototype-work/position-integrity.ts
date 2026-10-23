import { PrototypeWorkError } from "./store-error";

// Legacy stage/progress are presentation observations. They cannot be used as
// substitute phase decisions through a general Work Record snapshot.
const protectedFields = ["workspace", "stage", "status", "progress", "phaseConfigurationVersionId",
  "prototypeDecisionRights", "heldFrom", "heldNextAction", "heldNextActionDue", "heldNextActionImpact"] as const;

const syntheticSeedIds = new Set(["rybex-1", "rybex-2", "rybex-3", "rotork-1", "rotork-2", "rotork-3"]);

export function assertSnapshotPositionIntegrity(previous: Record<string, unknown>[], next: Record<string, unknown>[], catalog: Record<string, unknown>[] = []) {
  const byId = new Map(next.map((record) => [record.id, record]));
  if (byId.size !== next.length) throw new PrototypeWorkError("duplicate_work_id", 400, "Work Record identities must be unique.");
  for (const oldRecord of previous) {
    const newRecord = byId.get(oldRecord.id);
    if (!newRecord) throw new PrototypeWorkError("work_deletion_requires_command", 409, "Existing Work Records require a controlled removal.");
    if (protectedFields.some((field) => JSON.stringify(oldRecord[field]) !== JSON.stringify(newRecord[field])))
      throw new PrototypeWorkError("protected_position_changed", 409, "Use the applicable phase command to change work position or its pinned basis.");
  }
  for (const record of next) {
    if (previous.some((item) => item.id === record.id)) continue;
    if (!previous.length && syntheticSeedIds.has(String(record.id))) continue;
    const registered = catalog.find((item) => item.id === record.id && item.workspace === record.workspace);
    if (!registered || ["stage", "status", "progress", "phaseConfigurationVersionId"].some((field) =>
      JSON.stringify(registered[field]) !== JSON.stringify(record[field])))
      throw new PrototypeWorkError("unregistered_work_import", 409, "Create the Work Record through the shared catalog before adding its draft details.");
    if (record.design || record.deploy || record.operate || record.serviceSource || record.prototypeDecisionRights || record.heldFrom)
      throw new PrototypeWorkError("protected_work_import", 409, "Governed history requires its issuing command.");
  }
}
