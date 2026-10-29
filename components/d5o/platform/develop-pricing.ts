/** Deterministic prototype pricing contract. Amounts are stored in minor currency units. */
export type PricingCategory = "labor" | "material" | "equipment" | "subcontract" | "travel" | "mobilization" | "setup" | "recurring" | "other";
export type PricingScope = { kind: "customer" | "workType" | "region" | "default"; value: string };
export type PricingRate = { id: string; category: PricingCategory; label: string; unit: string; amount: string; scope: PricingScope; effectiveFrom: string; effectiveTo?: string; source: string; burdenPercent?: number; leadDays?: number; calendar?: "calendar" | "working" };
export type PricingPolicy = { id: string; version: number; status: "draft" | "published" | "superseded"; workspace: string; name: string; currency: string; effectiveFrom: string; effectiveTo?: string; rates: PricingRate[]; targetMarginPercent: number; floorMarginPercent: number; overheadPercent: number; contingencyPercent: number; maxDiscountPercent: number; method: "target-margin" | "markup" | "fixed-price"; markupPercent?: number; fixedPrice?: string; solutionApproverRole?: "admin" | "operations_leader"; pricingApproverRole: "admin" | "operations_leader"; marginExceptionRole?: "admin" | "operations_leader"; proposalApproverRole: "admin" | "operations_leader"; publishedAt?: string; publishedBy?: string };
export type PricingPolicyState = { pricingPolicies?: PricingPolicy[]; activePricingPolicy?: { id: string; version: number }; pricingPolicyHistory?: Array<{ at: string; action: string; policyId: string; version: number; actorId: string }> };
export type PricingLine = { id: string; scopeRef: string; category: PricingCategory; description: string; quantity: string; unit: string; rateId?: string; manualRate?: string; source: string; validUntil?: string; assumption: string; quantityBasis?: string; sourceKind?: "Assumed" | "Historical" | "Quoted" | "Policy rate"; sourceDate?: string; noCostReason?: string; recurringMonths?: number; procurementSource?: { quoteId: string; lineNumber: string; quoteRevision: string; documentId: string; unitPriceMinor: string; packSize: string }; procurement?: { leadDays: number; calendar: "calendar" | "working"; earliestOrderDate: string; requiredOnSite: string; bufferDays: number; supplierConfirmed: boolean; alternative?: string; expediteCost?: string; expediteDays?: number } };
export type RomCoverage = { obligationId: string; sourceRevision: number; treatment: "Line" | "Shared allowance" | "Customer responsibility" | "Excluded" | "Unresolved"; lineIds: string[]; rationale: string; owner: string; followUp: string };
export type RomBasis = { coverage: RomCoverage[]; installationScenario?: { lineId: string; units: number; unit: string; lowHoursPerUnit: number; baseHoursPerUnit: number; highHoursPerUnit: number; quantitySource: string; rationale: string }; communication?: { scope: string; assumptions: string; exclusions: string; informationNeeded: string; reviewDate: string; designValidation: string } };
export type PricingInput = { currency: string; workType: string; customer: string; region: string; pricedAt: string; expectedAwardDate?: string; lines: PricingLine[]; discountPercent: number; method?: PricingPolicy["method"]; fixedPrice?: string; riskBasis: string; estimateMaturity: "ROM" | "Budgetary" | "Firm"; definitionRevision: number; solutionRevision: number; romBasis?: RomBasis };
export type PricingIssue = { code: string; lineId?: string; message: string; action: string };
export type PricingEvaluation = { policyId: string; policyVersion: number; currency: string; input: PricingInput; lines: Array<{ id: string; category: PricingCategory; amountMinor: number; rateId?: string; rateSource: string; procurement?: { expectedDelivery: string; latestOrder: string; slackDays: number | null; confidence: "supplier-confirmed" | "assumed"; expedite?: { expectedDelivery: string; addedCostMinor: number; resultingMarginPercent: number | null; meetsRequiredDate: boolean; meetsMarginFloor: boolean } } }>; directCostMinor: number; overheadMinor: number; contingencyMinor: number; includedCostMinor: number; proposedPriceMinor: number; discountMinor: number; grossProfitMinor: number; marginPercent: number | null; annualRecurringMinor: number; totalRecurringMinor: number; minimumFloorPriceMinor: number; minimumTargetPriceMinor: number; absorbableCostMinor: number; issues: PricingIssue[]; recommendation: "Ready for pricing review" | "Hold for information" | "Escalate for margin decision"; calculatedAt: string };

export const currencyDigits = (currency: string): number => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const pct = (value: number) => Number.isFinite(value) && value >= 0 && value < 100;
const roundDiv = (numerator: number, denominator: number) => Math.round(numerator / denominator);
export function parseMinor(value: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  if (!(digits === 0 ? /^\d+$/.test(value) : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(value))) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
export function formatMinor(value: number, currency: string): string { return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: currencyDigits(currency), maximumFractionDigits: currencyDigits(currency) }).format(value / 10 ** currencyDigits(currency)); }
function quantityMilli(value: string): number | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
const rank = { customer: 0, workType: 1, region: 2, default: 3 } as const;
function applicable(rate: PricingRate, input: PricingInput) {
  const scopeMatch = rate.scope.kind === "default" || rate.scope.value.toLowerCase() === ({ customer: input.customer, workType: input.workType, region: input.region })[rate.scope.kind].toLowerCase();
  return scopeMatch && rate.effectiveFrom <= input.pricedAt && (!rate.effectiveTo || rate.effectiveTo >= input.pricedAt);
}
export function resolveRate(policy: PricingPolicy, input: PricingInput, line: PricingLine): { rate?: PricingRate; ambiguous: boolean } {
  const candidates = policy.rates.filter((rate) => rate.category === line.category && rate.unit === line.unit && rate.id === line.rateId && applicable(rate, input)).sort((a, b) => rank[a.scope.kind] - rank[b.scope.kind]);
  return { rate: candidates[0], ambiguous: candidates.length > 1 && rank[candidates[0].scope.kind] === rank[candidates[1].scope.kind] };
}
function addDays(day: string, count: number, calendar: "calendar" | "working"): string {
  const value = new Date(`${day}T12:00:00Z`);
  for (let left = Math.abs(count), direction = Math.sign(count); left > 0;) {
    value.setUTCDate(value.getUTCDate() + direction);
    if (calendar === "calendar" || ![0, 6].includes(value.getUTCDay())) left--;
  }
  return value.toISOString().slice(0, 10);
}
export function validatePricingPolicy(policy: PricingPolicy): string[] {
  const issues: string[] = [];
  if (!policy.rates.length) issues.push("Publish at least one applicable, sourced cost rate.");
  if (!policy.id || !policy.name.trim() || !/^[A-Z]{3}$/.test(policy.currency) || !date(policy.effectiveFrom) || policy.effectiveTo && (!date(policy.effectiveTo) || policy.effectiveTo < policy.effectiveFrom)) issues.push("Set a policy identity, ISO currency, and valid effective dates.");
  if (!pct(policy.targetMarginPercent) || !pct(policy.floorMarginPercent) || policy.floorMarginPercent > policy.targetMarginPercent || !pct(policy.overheadPercent) || !pct(policy.contingencyPercent) || !pct(policy.maxDiscountPercent)) issues.push("Margin, overhead, contingency, and discount rules must be finite valid percentages; the floor cannot exceed the target.");
  if (![policy.solutionApproverRole ?? "operations_leader", policy.pricingApproverRole, policy.marginExceptionRole ?? "admin", policy.proposalApproverRole].every((role) => role === "admin" || role === "operations_leader")) issues.push("Assign each review and exception to a supported membership role.");
  if (policy.method === "markup" && !pct(policy.markupPercent ?? NaN)) issues.push("Markup method requires a valid markup percentage.");
  if (policy.method === "fixed-price" && parseMinor(policy.fixedPrice ?? "", policy.currency) === null) issues.push("Fixed-price method requires a valid price in the policy currency.");
  if (!["target-margin", "markup", "fixed-price"].includes(policy.method)) issues.push("Select a supported price method.");
  for (const rate of policy.rates) {
    if (rate.scope.kind !== "default" && !rate.scope.value.trim()) issues.push(`Rate ${rate.label || rate.id} needs an exact applicability value.`);
    if (!rate.id || !rate.label.trim() || !rate.unit.trim() || !rate.source.trim() || parseMinor(rate.amount, policy.currency) === null || !date(rate.effectiveFrom) || rate.effectiveTo && (!date(rate.effectiveTo) || rate.effectiveTo < rate.effectiveFrom) || rate.burdenPercent !== undefined && !pct(rate.burdenPercent)) issues.push(`Rate ${rate.label || rate.id} needs a nonnegative amount, unit, source, valid dates, and burden.`);
    if (rate.leadDays !== undefined && (!Number.isInteger(rate.leadDays) || rate.leadDays < 0 || rate.leadDays > 3650)) issues.push(`Rate ${rate.label || rate.id} needs a valid supplier lead time.`);
  }
  for (let i = 0; i < policy.rates.length; i++) for (let j = i + 1; j < policy.rates.length; j++) {
    const a = policy.rates[i], b = policy.rates[j];
    if (a.id === b.id && a.category === b.category && a.unit === b.unit && a.scope.kind === b.scope.kind && a.scope.value === b.scope.value && a.effectiveFrom <= (b.effectiveTo ?? "9999-12-31") && b.effectiveFrom <= (a.effectiveTo ?? "9999-12-31")) issues.push(`Overlapping rate ${a.id} has ambiguous precedence.`);
  }
  return issues;
}
export function evaluatePricing(policy: PricingPolicy, input: PricingInput, calculatedAt = new Date().toISOString()): PricingEvaluation {
  const issues: PricingIssue[] = [];
  const add = (code: string, message: string, action: string, lineId?: string) => issues.push({ code, message, action, lineId });
  if (policy.status !== "published" || policy.currency !== input.currency || input.pricedAt < policy.effectiveFrom || policy.effectiveTo && input.pricedAt > policy.effectiveTo) add("policy", "No published pricing policy is effective for this currency and date.", "Select an effective published policy.");
  if (!date(input.pricedAt) || !Number.isInteger(input.definitionRevision) || !Number.isInteger(input.solutionRevision)) add("basis", "Estimate date or source revision is invalid.", "Select an exact Define and solution basis.");
  if (input.method && input.method !== policy.method) add("method", `The selected ${input.method} method is not authorized by this published ${policy.method} policy.`, "Publish an applicable pricing policy or use its governed method.");
  if (input.expectedAwardDate && !date(input.expectedAwardDate)) add("award_date", "Expected award date is invalid.", "Record a valid anticipated customer decision date.");
  if (!input.lines.length) add("lines", "No cost lines are recorded.", "Add sourced quantities or hours; unknown cost cannot be treated as zero.");
  const usedQuotes = new Set<string>();
  let directCostMinor = 0, annualRecurringMinor = 0, totalRecurringMinor = 0;
  const lines = input.lines.map((line) => {
    const q = quantityMilli(line.quantity);
    const { rate, ambiguous } = line.rateId ? resolveRate(policy, input, line) : { rate: undefined, ambiguous: false };
    if (ambiguous) add("ambiguous_rate", `More than one equally specific rate applies to ${line.description}.`, "Resolve the conflicting policy rates.", line.id);
    if (line.rateId && !rate) add("missing_rate", `Rate ${line.rateId} is unavailable for ${line.description}, ${line.unit}, and the estimate date.`, "Publish a matching effective rate or select another evidenced rate.", line.id);
    if (rate && rate.effectiveTo && rate.effectiveTo < input.pricedAt) add("expired_rate", `Rate ${rate.label} expired.`, "Refresh the catalog rate.", line.id);
    if (!line.scopeRef.trim() || !line.description.trim() || !line.source.trim() || !line.assumption.trim() || !q) add("incomplete_line", `${line.description || "A line"} lacks a scope reference, source, assumption, or positive quantity.`, "Complete the line before pricing review.", line.id);
    const base = rate ? parseMinor(rate.amount, input.currency) : parseMinor(line.manualRate ?? "", input.currency);
    if (base === null) add("missing_cost", `${line.description || "A line"} has no valid cost rate.`, "Record a nonnegative sourced rate; do not assume zero.", line.id);
    if (line.validUntil && (!date(line.validUntil) || line.validUntil < input.pricedAt || input.expectedAwardDate && line.validUntil < input.expectedAwardDate)) add("expired_quote", `${line.description} quotation expires before the pricing or expected award date.`, "Refresh the quotation before submitting or identify repricing exposure.", line.id);
    if (["material", "equipment", "subcontract"].includes(line.category) && usedQuotes.has(line.source)) add("duplicate_quote", `${line.source} is used on multiple procurement lines.`, "Confirm distinct coverage to prevent double counting.", line.id);
    if (["material", "equipment", "subcontract"].includes(line.category)) usedQuotes.add(line.source);
    const burden = line.category === "labor" && rate?.burdenPercent ? rate.burdenPercent : 0;
    const periodAmountMinor = q && base !== null ? roundDiv(q * base * (100 + burden), 1000 * 100) : 0;
    const months = line.category === "recurring" ? line.recurringMonths : undefined;
    const amountMinor = line.category === "recurring" ? periodAmountMinor * (Number.isInteger(months) && (months ?? 0) > 0 ? months! : 0) : periodAmountMinor;
    if (!Number.isSafeInteger(amountMinor)) add("overflow", `${line.description} exceeds supported money precision.`, "Reduce the input range.", line.id);
    directCostMinor += amountMinor;
    if (line.category === "recurring") { if (!Number.isInteger(months) || (months ?? 0) < 1 || months! > 600) add("recurring_period", `${line.description} needs a contract duration of 1–600 months.`, "Record the recurring period.", line.id); else { totalRecurringMinor += amountMinor; annualRecurringMinor += periodAmountMinor * Math.min(months!, 12); } }
    let procurement: PricingEvaluation["lines"][number]["procurement"];
    if (line.procurement) {
      const p = line.procurement;
      if (!date(p.earliestOrderDate) || !date(p.requiredOnSite) || !Number.isInteger(p.leadDays) || p.leadDays < 0 || p.leadDays > 3650 || !Number.isInteger(p.bufferDays) || p.bufferDays < 0 || p.bufferDays > 3650) add("procurement_input", `${line.description} needs valid order, required dates, lead time, and buffer.`, "Correct procurement timing.", line.id);
      else {
        const earliestOrder = input.expectedAwardDate && input.expectedAwardDate > p.earliestOrderDate ? input.expectedAwardDate : p.earliestOrderDate;
        const expectedDelivery = addDays(earliestOrder, p.leadDays + p.bufferDays, p.calendar);
        const latestOrder = addDays(p.requiredOnSite, -(p.leadDays + p.bufferDays), p.calendar);
        const slackDays = Math.round((Date.parse(`${p.requiredOnSite}T12:00:00Z`) - Date.parse(`${expectedDelivery}T12:00:00Z`)) / 86400000);
        procurement = { expectedDelivery, latestOrder, slackDays, confidence: p.supplierConfirmed ? "supplier-confirmed" : "assumed" };
        if (slackDays < 0) add("late_procurement", `${line.description} arrives ${-slackDays} calendar days after the required site date under the ${p.supplierConfirmed ? "supplier-confirmed" : "assumed"} ${p.leadDays}-day lead time and ${p.bufferDays}-day buffer.`, p.alternative ? `Assess approved alternative ${p.alternative} or change the sequence/date; do not order implicitly.` : "Seek earlier authorization, an approved alternative, or a changed sequence/date.", line.id);
        if (!p.supplierConfirmed) add("lead_uncertain", `${line.description} delivery date is a planning assumption.`, "Confirm supplier availability before committing to a customer date.", line.id);
      }
    }
    return { id: line.id, category: line.category, amountMinor, rateId: rate?.id, rateSource: rate?.source ?? line.source, procurement };
  });
  if (!Number.isSafeInteger(directCostMinor) || !Number.isSafeInteger(totalRecurringMinor)) add("overflow", "The total exceeds supported money precision.", "Reduce the input range.");
  const overheadMinor = roundDiv(directCostMinor * policy.overheadPercent, 100);
  const contingencyMinor = roundDiv(directCostMinor * policy.contingencyPercent, 100);
  const includedCostMinor = directCostMinor + overheadMinor + contingencyMinor;
  const method = input.method ?? policy.method;
  const basePrice = method === "fixed-price" ? parseMinor(input.fixedPrice ?? policy.fixedPrice ?? "", input.currency) : method === "markup" ? roundDiv(includedCostMinor * (100 + (policy.markupPercent ?? 0)), 100) : policy.targetMarginPercent < 100 ? Math.ceil(includedCostMinor * 100 / (100 - policy.targetMarginPercent)) : null;
  if (basePrice === null || !Number.isSafeInteger(basePrice)) add("price", "The configured price method cannot produce a valid price.", "Correct the pricing method and amount.");
  if (!pct(input.discountPercent) || input.discountPercent > policy.maxDiscountPercent) add("discount", `Discount ${input.discountPercent}% exceeds the permitted ${policy.maxDiscountPercent}% or is invalid.`, "Reduce discount or request the configured exception.");
  const discountMinor = basePrice === null ? 0 : roundDiv(basePrice * input.discountPercent, 100);
  const proposedPriceMinor = Math.max(0, (basePrice ?? 0) - discountMinor);
  const grossProfitMinor = proposedPriceMinor - includedCostMinor;
  const marginPercent = proposedPriceMinor > 0 ? grossProfitMinor / proposedPriceMinor * 100 : null;
  const minimumFloorPriceMinor = Math.ceil(includedCostMinor * 100 / (100 - policy.floorMarginPercent));
  const minimumTargetPriceMinor = Math.ceil(includedCostMinor * 100 / (100 - policy.targetMarginPercent));
  const absorbableCostMinor = proposedPriceMinor - Math.ceil(proposedPriceMinor * policy.floorMarginPercent / 100) - includedCostMinor;
  for (let index = 0; index < input.lines.length; index++) {
    const source = input.lines[index], procurement = source.procurement, result = lines[index].procurement;
    if (!procurement || !result || procurement.expediteCost === undefined && procurement.expediteDays === undefined) continue;
    const expediteMinor = parseMinor(procurement.expediteCost ?? "", input.currency);
    if (expediteMinor === null || !Number.isInteger(procurement.expediteDays) || procurement.expediteDays! < 1 || procurement.expediteDays! > procurement.leadDays) { add("expedite_input", `${source.description} expedite option lacks an evidenced positive cost or valid lead-time reduction.`, "Correct the supplier expedite offer before comparing it.", source.id); continue; }
    const earliest = input.expectedAwardDate && input.expectedAwardDate > procurement.earliestOrderDate ? input.expectedAwardDate : procurement.earliestOrderDate;
    const expeditedDelivery = addDays(earliest, procurement.leadDays - procurement.expediteDays! + procurement.bufferDays, procurement.calendar);
    const addedCostMinor = roundDiv(expediteMinor * (100 + policy.overheadPercent + policy.contingencyPercent), 100);
    const expeditedMargin = proposedPriceMinor > 0 ? (proposedPriceMinor - includedCostMinor - addedCostMinor) / proposedPriceMinor * 100 : null;
    result.expedite = { expectedDelivery: expeditedDelivery, addedCostMinor, resultingMarginPercent: expeditedMargin, meetsRequiredDate: expeditedDelivery <= procurement.requiredOnSite, meetsMarginFloor: expeditedMargin !== null && expeditedMargin >= policy.floorMarginPercent };
    if (result.slackDays !== null && result.slackDays < 0) add("expedite_option", `${source.description}: evidenced expedite adds ${formatMinor(addedCostMinor, input.currency)} to the included cost and arrives ${expeditedDelivery}; margin at unchanged price becomes ${expeditedMargin?.toFixed(1) ?? "unknown"}%.`, result.expedite.meetsRequiredDate && result.expedite.meetsMarginFloor ? "Compare the expedited delivery with an approved alternative, then adopt a new estimate revision and obtain approval." : "The expedite does not satisfy both the required date and margin floor; seek a schedule, price, or approved-alternative decision.", source.id);
  }
  if (marginPercent !== null && marginPercent < policy.floorMarginPercent) add("below_floor", `Included-cost margin ${marginPercent.toFixed(1)}% is below the ${policy.floorMarginPercent}% floor.`, `Raise the price to at least ${formatMinor(minimumFloorPriceMinor, input.currency)} or route the specified margin exception.`);
  return { policyId: policy.id, policyVersion: policy.version, currency: input.currency, input, lines, directCostMinor, overheadMinor, contingencyMinor, includedCostMinor, proposedPriceMinor, discountMinor, grossProfitMinor, marginPercent, annualRecurringMinor, totalRecurringMinor, minimumFloorPriceMinor, minimumTargetPriceMinor, absorbableCostMinor, issues, recommendation: issues.some((item) => item.code === "below_floor") ? "Escalate for margin decision" : issues.length ? "Hold for information" : "Ready for pricing review", calculatedAt };
}
