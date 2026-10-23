import "server-only";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceKey } from "@/components/d5o/platform/schedule-model";
import { seededWorkIds, type CatalogMutation, type CatalogWorkPackage, type CatalogWorkRecord, type SharedWorkCatalog } from "@/components/d5o/platform/work-catalog-model";

const root = path.join(process.cwd(), ".rybexos-local", "d5o-shared-work-v1");
const fileFor = (workspace: WorkspaceKey) => path.join(root, `${workspace}.json`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export class CatalogError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }

function initial(workspace: WorkspaceKey): SharedWorkCatalog {
  return { schemaVersion: 1, workspace, revision: 1, records: [], packages: [] };
}
export function initialHostedCatalog(workspace: WorkspaceKey): SharedWorkCatalog {
  return { ...initial(workspace), revision: 0 };
}
async function readUnlocked(workspace: WorkspaceKey): Promise<SharedWorkCatalog | null> {
  let raw: string;
  try { raw = await readFile(fileFor(workspace), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let state: SharedWorkCatalog;
  try { state = JSON.parse(raw) as SharedWorkCatalog; }
  catch { throw new CatalogError("invalid_catalog", 500, "The shared Work Record catalog cannot be parsed."); }
  if (state.schemaVersion !== 1 || state.workspace !== workspace || !Number.isInteger(state.revision)
      || !Array.isArray(state.records) || !Array.isArray(state.packages))
    throw new CatalogError("invalid_catalog", 500, "The shared Work Record catalog needs review.");
  return state;
}
async function writeUnlocked(workspace: WorkspaceKey, state: SharedWorkCatalog) {
  const target = fileFor(workspace);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" }); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
async function locked<T>(workspace: WorkspaceKey, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const lock = `${fileFor(workspace)}.lock`;
  for (let attempt = 0; attempt < 40; attempt++) {
    let handle;
    try { handle = await open(lock, "wx"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await wait(25 + attempt * 5); continue; }
    try { return await action(); }
    finally { await handle.close(); await rm(lock, { force: true }); }
  }
  throw new CatalogError("catalog_busy", 503, "The shared Work Record catalog is busy. Refresh and retry.");
}
function required(value: unknown, label: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new CatalogError("invalid_record", 400, `${label} is required and must be under ${max} characters.`);
  return value.trim();
}
function optional(value: unknown, max = 200) {
  if (typeof value !== "string" || value.length > max) throw new CatalogError("invalid_record", 400, "Invalid Work Record detail.");
  return value.trim();
}
function registeredRecord(value: CatalogWorkRecord, workspace: WorkspaceKey, actor: { id: string; name: string }): CatalogWorkRecord {
  // Earlier Operate prototypes generated service-/lifecycle- UUID identities.
  // Keep those stable while all newly generated records use tenant-scoped IDs.
  const compatibleId = typeof value?.id === "string" && (new RegExp(`^${workspace}-[0-9a-f]{12,}$`).test(value.id)
    || /^(service|lifecycle)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id));
  if (!value || !compatibleId
      || value.workspace !== workspace || !["attention", "moving", "complete"].includes(value.status)
      || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100
      || !Array.isArray(value.proof) || !Array.isArray(value.blockers) || !Array.isArray(value.history)
      || value.proof.length > 100 || value.blockers.length > 100 || value.history.length > 200
      || [...value.proof, ...value.blockers, ...value.history].some((item) => typeof item !== "string" || item.length > 500))
    throw new CatalogError("invalid_record", 400, "The browser-only Work Record cannot be registered in the shared workspace.");
  return {
    id: value.id, workspace, title: required(value.title, "Title"), type: required(value.type, "Work Type"),
    phaseConfigurationVersionId: value.phaseConfigurationVersionId,
    customer: required(value.customer, "Customer"), site: required(value.site, "Site"),
    stage: required(value.stage, "Stage"), owner: required(value.owner, "Owner"),
    nextAction: required(value.nextAction, "Next action"), progress: value.progress,
    value: optional(value.value), status: value.status, proof: value.proof, blockers: value.blockers,
    history: value.history, createdAt: new Date().toISOString(), createdBy: actor.id
  };
}

export async function loadWorkCatalog(workspace: WorkspaceKey) {
  return locked(workspace, async () => {
    const state = await readUnlocked(workspace);
    if (state) return state;
    const created = initial(workspace);
    await writeUnlocked(workspace, created);
    return created;
  });
}
export async function hasCatalogPackage(workspace: WorkspaceKey, workId: string, packageId: string) {
  return locked(workspace, async () => {
    const state = await readUnlocked(workspace);
    return Boolean(state?.packages.some((item) => item.id === packageId && item.workId === workId));
  });
}
export async function mutateWorkCatalog(workspace: WorkspaceKey, actor: { id: string; name: string }, input: CatalogMutation) {
  return locked(workspace, async () => {
    const state = await readUnlocked(workspace) ?? initial(workspace);
    const result = applyCatalogMutation(workspace, actor, state, input);
    if (result.changed) await writeUnlocked(workspace, state);
    return { catalog: state, created: result.created };
  });
}

/** Shared validation and transition logic; persistence is selected by the caller. */
export function applyCatalogMutation(workspace: WorkspaceKey, actor: { id: string; name: string }, state: SharedWorkCatalog, input: CatalogMutation): { created: CatalogWorkRecord | CatalogWorkPackage; changed: boolean } {
  if (state.workspace !== workspace || !Number.isInteger(input.expectedRevision) || input.expectedRevision !== state.revision)
    throw new CatalogError("stale_catalog", 409, "Another session changed the shared work plan. Refresh and retry.");
  let created: CatalogWorkRecord | CatalogWorkPackage;
  if (input.action === "create-record") {
      const title = required(input.title, "Title");
      const type = required(input.type, "Work Type");
      const customer = optional(input.customer) || "Customer to be confirmed";
      const site = optional(input.site) || "Site to be confirmed";
      const value = optional(input.value) || "Value commitment to be defined";
      const owner = required(input.owner, "Accountable owner");
      created = {
        id: `${workspace}-${crypto.randomUUID().replaceAll("-", "")}`, workspace, title, type, phaseConfigurationVersionId: input.phaseConfigurationVersionId, customer, site,
        stage: workspace === "rybex" ? "Plan" : "Assessment", owner,
        nextAction: workspace === "rybex" ? "Build delivery plan" : "Complete assessment", progress: 8,
        value, status: "moving", proof: [], blockers: [], history: ["Work Record started"],
        createdAt: new Date().toISOString(), createdBy: actor.id
      };
      state.records.push(created);
  } else if (input.action === "register-record") {
      const existing = state.records.find((item) => item.id === input.record?.id);
      if (existing) return { created: existing, changed: false };
      created = registeredRecord(input.record, workspace, actor);
      state.records.push(created);
  } else if (input.action === "create-package") {
      if (!seededWorkIds[workspace].includes(input.workId) && !state.records.some((item) => item.id === input.workId))
        throw new CatalogError("record_unavailable", 404, "The Work Record must be shared before a package can be added.");
      if (state.packages.length >= 500) throw new CatalogError("catalog_full", 409, "The prototype shared package catalog is full.");
      created = {
        id: `wp-${crypto.randomUUID().replaceAll("-", "")}`, workId: input.workId,
        name: required(input.name, "Package name"), owner: required(input.owner, "Package owner"),
        installed: 0, tested: 0, accepted: 0, status: "planned",
        createdAt: new Date().toISOString(), createdBy: actor.id
      };
      state.packages.push(created);
  } else throw new CatalogError("invalid_action", 400, "Unknown work catalog action.");
  state.revision++;
  return { created, changed: true };
}
