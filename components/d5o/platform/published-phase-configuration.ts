import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { prototypePhaseConfigurationCatalog, stageAlignedPhaseConfigurationCatalog, resolvePrototypePhaseConfiguration, validatePhaseConfiguration, type WorkTypeConfiguration } from "./phase-configuration";
import type { WorkRecord, WorkspaceKey } from "./work-types";
import { validateDesignControlPolicy } from "./design-policy";
import { validateDeployControlPolicy } from "./deploy-policy";
import { validateOperateControlPolicy } from "./operate-policy";

export type PublishedPhaseContract = { schemaVersion: 1; workTypes: WorkTypeConfiguration[] };

export function defaultPhaseContract(workspace: WorkspaceKey): PublishedPhaseContract {
  return { schemaVersion: 1, workTypes: structuredClone(stageAlignedPhaseConfigurationCatalog[workspace]) };
}

export function validatePublishedPhaseContract(value: unknown, workspace: WorkspaceKey): string[] {
  try { return validateContract(value, workspace); } catch { return ["Phase contract structure is invalid."]; }
}

function validateContract(value: unknown, workspace: WorkspaceKey): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Phase contract must be an object."];
  const contract = value as Partial<PublishedPhaseContract>;
  if (contract.schemaVersion !== 1 || !Array.isArray(contract.workTypes)) return ["Phase contract schema or Work Types are invalid."];
  const errors: string[] = [];
  const keys = new Set<string>();
  const allowedFacts = new Set(["discovery.need", "discovery.fit", "discovery.estimate.status", "discovery.proposal.status", "definition.outcome", "definition.excludedScope", "definition.deliveryApproach", "definition.registers.scope_items", "definition.registers.acceptance_criteria", "definition.registers.milestones", "definition.registers.dependencies", "definition.registers.risks"]);
  for (const item of contract.workTypes) {
    if (!item || typeof item !== "object" || typeof item.workTypeKey !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(item.workTypeKey) || typeof item.workTypeLabel !== "string" || !item.workTypeLabel.trim()) { errors.push("Invalid Work Type identity."); continue; }
    if (keys.has(item.workTypeKey)) errors.push(`Duplicate Work Type: ${item.workTypeKey}`);
    keys.add(item.workTypeKey);
    if (!Array.isArray(item.phases)) { errors.push(`${item.workTypeKey} has no phases.`); continue; }
    if (JSON.stringify(item.phases.map((phase) => phase.key)) !== JSON.stringify(["discover", "define", "develop", "design", "deploy", "operate"])) errors.push(`${item.workTypeKey} changed the supported phase order.`);
    errors.push(...validatePhaseConfiguration(item));
    if (item.designControls) errors.push(...validateDesignControlPolicy(item.designControls).map((message) => `${item.workTypeKey}: ${message}`));
    if (item.deployControls) errors.push(...validateDeployControlPolicy(item.deployControls).map((message) => `${item.workTypeKey}: ${message}`));
    if (item.operateControls) errors.push(...validateOperateControlPolicy(item.operateControls).map((message) => `${item.workTypeKey}: ${message}`));
    for (const phase of item.phases) {
      if (!Array.isArray(phase.components)) { errors.push(`${phase.key} has no components.`); continue; }
      for (const component of phase.components) {
        if (!component.key || !component.label?.trim() || !component.help?.trim()) errors.push(`${phase.key} has an incomplete component.`);
        if (["develop", "design", "deploy", "operate"].includes(phase.key) && (component.fields?.length ?? 0) > 0 && !["develop.solution_options", "design.verification_plan", "operate.handoff"].includes(`${phase.key}.${component.key}`)) errors.push(`${component.key} cannot create a duplicate phase register.`);
        for (const field of component.fields ?? []) if (!field.key || !field.label?.trim() || !["text", "date", "select"].includes(field.kind) || typeof field.required !== "boolean") errors.push(`${component.key} has an invalid field.`);
        for (const rule of component.rules ?? []) if (!allowedFacts.has(rule.fact) || !["present", "equals", "rows_complete"].includes(rule.operator) || !["draft", "review", "authorization"].includes(rule.requiredAt) || !rule.message?.trim()) errors.push(`${component.key} has an invalid rule.`);
      }
    }
  }
  const versions = new Set(contract.workTypes.map((item) => item.version));
  if (versions.size !== 1 || !versions.has("prototype-v1") && !versions.has("prototype-v2")) errors.push("All Work Types must use one supported phase-contract generation.");
  const reference = versions.has("prototype-v2") ? stageAlignedPhaseConfigurationCatalog[workspace] : prototypePhaseConfigurationCatalog[workspace];
  if (keys.size < reference.length) errors.push("The phase contract must retain the original Work Type identities.");
  for (const item of contract.workTypes) if (!reference.some((base) => base.workTypeKey === (item.engineTemplateKey ?? item.workTypeKey))) errors.push(`Unsupported engine template for ${item.workTypeKey}.`);
  for (const required of reference) if (!contract.workTypes.some((item) => item.workTypeKey === required.workTypeKey)) errors.push(`Missing original Work Type: ${required.workTypeKey}`);
  for (const configured of contract.workTypes) {
    const required = reference.find((item) => item.workTypeKey === (configured.engineTemplateKey ?? configured.workTypeKey));
    if (!required) continue;
    for (const basePhase of required.phases) {
      const phase = configured.phases.find((entry) => entry.key === basePhase.key);
      if (!phase) continue;
      for (const baseComponent of basePhase.components) {
        const component = phase.components.find((entry) => entry.key === baseComponent.key);
        if (!component || component.kind !== baseComponent.kind || component.source !== baseComponent.source) { errors.push(`${baseComponent.key} has changed its binding.`); continue; }
        if (basePhase.key === "define") for (const baseField of baseComponent.fields ?? []) if (!component.fields?.some((entry) => entry.key === baseField.key && entry.kind === baseField.kind)) errors.push(`${baseComponent.key} removed a bound field.`);
        if (component.kind !== "item_register") for (const field of component.fields ?? []) {
          const original = baseComponent.fields?.find((entry) => entry.key === field.key);
          const earlierDecisionDate = basePhase.key === "discover" && field.key === "closeDate" && original?.required === false && field.required === true;
          if (!original || original.kind !== field.kind || (!earlierDecisionDate && original.required !== field.required) || JSON.stringify(original.options ?? []) !== JSON.stringify(field.options ?? [])) errors.push(`${baseComponent.key} changed an unsupported field binding.`);
        }
        if (new Set((component.fields ?? []).map((entry) => entry.key)).size !== (component.fields ?? []).length) errors.push(`${baseComponent.key} has duplicate field keys.`);
        for (const baseRule of baseComponent.rules ?? []) {
          const rule = component.rules?.find((entry) => entry.key === baseRule.key);
          if (!rule || rule.fact !== baseRule.fact || rule.operator !== baseRule.operator || rule.value !== baseRule.value || rule.requiredAt !== baseRule.requiredAt) { errors.push(`${baseRule.key} changed its protected rule semantics.`); continue; }
          if (rule.operator === "rows_complete") {
            const requiredFields = (component.fields ?? []).filter((entry) => entry.required).map((entry) => entry.key);
            if (!requiredFields.length || JSON.stringify([...requiredFields].sort()) !== JSON.stringify([...(rule.fields ?? [])].sort())) errors.push(`${baseRule.key} does not match required register fields.`);
          }
        }
        if ((component.rules ?? []).length !== (baseComponent.rules ?? []).length) errors.push(`${baseComponent.key} changed protected rule count.`);
      }
      if (phase.components.length !== basePhase.components.length) errors.push(`${phase.key} changed protected component structure.`);
    }
  }
  return errors;
}

export function phaseContractFromManifest(manifest: Record<string, unknown> | undefined, workspace: WorkspaceKey): PublishedPhaseContract | null {
  const value = (manifest?.d5oPresentation as Record<string, unknown> | undefined)?.phaseContract;
  return validatePublishedPhaseContract(value, workspace).length ? null : value as PublishedPhaseContract;
}

export function resolvePublishedPhaseConfiguration(inventory: ConfigurationInventory, workspace: WorkspaceKey, workType: string, work?: WorkRecord): WorkTypeConfiguration | null {
  if (inventory.status !== "ready") return null;
  if (work && !work.phaseConfigurationVersionId) return resolvePrototypePhaseConfiguration(workspace, workType);
  const versionId = work?.phaseConfigurationVersionId ?? inventory.activeVersionId;
  const version = inventory.versions.find((item) => item.id === versionId && ["published", "superseded"].includes(item.status));
  if (!version) return null;
  const contract = phaseContractFromManifest(version.config_manifest_json, workspace);
  if (!contract) return null;
  const normalized = workType.trim().toLowerCase();
  const config = contract.workTypes.find((item) => item.workTypeKey === normalized || item.workTypeLabel.toLowerCase() === normalized);
  const labels = (version.config_manifest_json?.d5oPresentation as { phaseLabels?: Record<string, string> } | undefined)?.phaseLabels ?? {};
  return config ? { ...config, version: version.id, phases: config.phases.map((phase) => ({ ...phase, label: labels[phase.key] || phase.label })) } : null;
}

export function activePhaseConfigurationVersion(inventory: ConfigurationInventory, workspace: WorkspaceKey, workType: string): string | null {
  if (inventory.status !== "ready") return null;
  const version = inventory.versions.find((item) => item.id === inventory.activeVersionId);
  const contract = phaseContractFromManifest(version?.config_manifest_json, workspace);
  const normalized = workType.trim().toLowerCase();
  const selected = contract?.workTypes.find((item) => item.workTypeKey === normalized || item.workTypeLabel.toLowerCase() === normalized);
  return selected && activeRegistryEntry(version?.config_manifest_json, selected.workTypeKey) ? version?.id ?? null : null;
}

export function publishedWorkTypePinIsValid(inventory: ConfigurationInventory, workspace: WorkspaceKey, workType: string, versionId: string, requireActive: boolean): boolean {
  if (inventory.status !== "ready" || !versionId || (requireActive && inventory.activeVersionId !== versionId)) return false;
  const version = inventory.versions.find((item) => item.id === versionId && ["published", "superseded"].includes(item.status));
  const contract = phaseContractFromManifest(version?.config_manifest_json, workspace);
  const normalized = workType.trim().toLowerCase();
  const selected = contract?.workTypes.find((item) => item.workTypeKey === normalized || item.workTypeLabel.toLowerCase() === normalized);
  return Boolean(selected && (!requireActive || activeRegistryEntry(version?.config_manifest_json, selected.workTypeKey)));
}

function activeRegistryEntry(manifest: Record<string, unknown> | undefined, key: string): boolean {
  const entries = manifest?.workTypes;
  return Array.isArray(entries) && entries.some((entry) => entry && typeof entry === "object"
    && (entry as { key?: unknown }).key === key && (entry as { status?: unknown }).status !== "disabled");
}

export function activePublishedWorkTypeLabels(manifest: Record<string, unknown> | undefined, workspace: WorkspaceKey): string[] {
  const contract = phaseContractFromManifest(manifest, workspace);
  return contract?.workTypes.filter((item) => activeRegistryEntry(manifest, item.workTypeKey)).map((item) => item.workTypeLabel) ?? [];
}
