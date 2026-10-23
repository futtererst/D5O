import { validatePricingPolicy, type PricingPolicy, type PricingPolicyState } from "@/components/d5o/platform/develop-pricing";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";
import { PrototypeWorkError } from "./store-error";

export type PricingPolicyCommand = { action: "save-draft" | "publish" | "activate"; expectedRevision: number; commandId?: string; policy?: PricingPolicy; policyId?: string; policyVersion?: number };
export function applyPricingPolicyCommand<T extends PricingPolicyState>(state: T, workspace: WorkspaceKey, actor: { id: string; role: string }, command: PricingPolicyCommand): T {
  if (actor.role !== "admin") throw new PrototypeWorkError("pricing_config_forbidden", 403, "Only a System Administrator may change pricing configuration.");
  const policies = state.pricingPolicies ?? [];
  const now = new Date().toISOString();
  let next: PricingPolicy[];
  let activePricingPolicy = state.activePricingPolicy;
  let policy: PricingPolicy;
  if (command.action === "save-draft") {
    policy = command.policy!;
    if (!policy || policy.workspace !== workspace || policy.status !== "draft" || !Number.isInteger(policy.version) || policy.version < 1) throw new PrototypeWorkError("invalid_policy", 400, "Save a scoped draft policy.");
    const previous = policies.find((item) => item.id === policy.id && item.version === policy.version);
    if (previous && previous.status !== "draft") throw new PrototypeWorkError("published_policy_immutable", 409, "Published policies are immutable; start a new version.");
    if (policies.some((item) => item.id === policy.id && item.version > policy.version)) throw new PrototypeWorkError("stale_policy_version", 409, "A newer policy version exists.");
    next = [...policies.filter((item) => !(item.id === policy.id && item.version === policy.version)), structuredClone(policy)];
  } else {
    policy = policies.find((item) => item.id === command.policyId && item.version === command.policyVersion && item.workspace === workspace && (command.action === "publish" ? item.status === "draft" : item.status === "published"))!;
    if (!policy) throw new PrototypeWorkError("policy_unavailable", 404, "The requested policy version is unavailable.");
    if (command.action === "publish") {
      const errors = validatePricingPolicy(policy);
      if (errors.length) throw new PrototypeWorkError("invalid_policy", 422, errors.join(" "));
      next = policies.map((item) => item === policy ? { ...item, status: "published" as const, publishedAt: now, publishedBy: actor.id } : item);
    } else {
      if (policy.workspace !== workspace) throw new PrototypeWorkError("workspace_forbidden", 403, "Pricing policies cannot cross workspaces.");
      if (policy.effectiveFrom > now.slice(0, 10) || policy.effectiveTo && policy.effectiveTo < now.slice(0, 10)) throw new PrototypeWorkError("policy_not_effective", 409, "Activate a published policy within its effective dates.");
      activePricingPolicy = { id: policy.id, version: policy.version };
      next = policies.map((item) => item.id === policy.id && item.version === policy.version ? item : item.id === state.activePricingPolicy?.id && item.version === state.activePricingPolicy.version && item.status === "published" ? { ...item, status: "superseded" as const } : item);
    }
  }
  return { ...state, pricingPolicies: next, activePricingPolicy, pricingPolicyHistory: [...(state.pricingPolicyHistory ?? []), { at: now, action: command.action, policyId: policy.id, version: policy.version, actorId: actor.id }] };
}
