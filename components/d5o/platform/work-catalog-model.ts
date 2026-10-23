import type { WorkspaceKey } from "./schedule-model";

/** Shared identity and package ownership for the local D5O prototype. */
export type CatalogWorkRecord = {
  id: string;
  canonicalWorkId?: string;
  workspace: WorkspaceKey;
  title: string;
  type: string;
  phaseConfigurationVersionId?: string;
  customer: string;
  site: string;
  stage: string;
  owner: string;
  nextAction: string;
  progress: number;
  value: string;
  status: "attention" | "moving" | "complete";
  proof: string[];
  blockers: string[];
  history: string[];
  createdAt: string;
  createdBy: string;
};

export type CatalogWorkPackage = {
  id: string;
  workId: string;
  name: string;
  owner: string;
  installed: number;
  tested: number;
  accepted: number;
  status: "planned" | "in progress" | "ready" | "accepted";
  createdAt: string;
  createdBy: string;
};

export type SharedWorkCatalog = {
  schemaVersion: 1;
  workspace: WorkspaceKey;
  revision: number;
  records: CatalogWorkRecord[];
  packages: CatalogWorkPackage[];
};

export type CatalogMutation =
  | { action: "create-record"; expectedRevision: number; commandId?: string; title: string; type: string; phaseConfigurationVersionId: string; customer: string; site: string; value: string; owner: string; initialDiscovery?: { source: string; need: string; procurement: string; closeDate: string } }
  | { action: "register-record"; expectedRevision: number; record: CatalogWorkRecord }
  | { action: "create-package"; expectedRevision: number; workId: string; name: string; owner: string; commandId?: string; expectedWorkRevision?: number; expectedHandoffRevision?: number; expectedPackageCount?: number };

export const seededWorkIds: Record<WorkspaceKey, readonly string[]> = {
  rybex: ["rybex-1", "rybex-2", "rybex-3"],
  rotork: ["rotork-1", "rotork-2", "rotork-3"]
};
