"use client";

import type { PricingInput, PricingPolicy, RomBasis, RomCoverage } from "./develop-pricing";
import { formatMinor } from "./develop-pricing";
import { assessRomCoverage, romObligations, romScenarioPrices, updateRomCoverage } from "./rom-model";
import type { DefinitionRecord } from "./work-types";
import styles from "./DevelopPlanning.module.css";

export function RomBasisPanel({ definition, input, policy, onChange }: {
  definition?: DefinitionRecord; input: PricingInput; policy?: PricingPolicy;
  onChange: (next: PricingInput) => void;
}) {
  const obligations = romObligations(definition);
  const basis: RomBasis = input.romBasis ?? { coverage: [] };
  const issues = assessRomCoverage(input, obligations);
  const scenarios = policy ? romScenarioPrices(policy, input) : null;
  const change = (row: RomCoverage) => onChange({ ...input, romBasis: { ...basis, coverage: updateRomCoverage(basis.coverage, row) } });
  return <section className={styles.content} aria-label="ROM requirement coverage and scenarios">
    <h3>Requirements to ROM</h3><p>Connect each approved obligation to one or more cost lines. A shared line is calculated once even when it covers several requirements. Unresolved scope blocks review; estimates do not change Define facts.</p>
    {!obligations.length ? <p className={styles.issue}>No structured approved obligations were received. Return to Define before pricing this ROM.</p> : obligations.map((obligation) => {
      const row = basis.coverage.find((item) => item.obligationId === obligation.id) ?? { obligationId: obligation.id, sourceRevision: obligation.sourceRevision, treatment: "Unresolved" as const, lineIds: [], rationale: "", owner: "", followUp: "" };
      return <article className={styles.option} key={obligation.id}>
        <small>{obligation.kind} · Define revision {obligation.sourceRevision} · {obligation.confirmed ? "Confirmed" : "Open or assumed"}</small>
        <h4>{obligation.label}</h4>
        <div className={styles.columns}>
          <label>Treatment<select value={row.treatment} onChange={(event) => change({ ...row, treatment: event.target.value as RomCoverage["treatment"] })}>{["Unresolved", "Line", "Shared allowance", "Customer responsibility", "Excluded"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Accountable owner<input value={row.owner} onChange={(event) => change({ ...row, owner: event.target.value })} placeholder="Role or accountable person" /></label>
        </div>
        {row.treatment === "Line" || row.treatment === "Shared allowance" ? <fieldset><legend>Linked estimating lines</legend>{input.lines.map((line) => <label key={line.id}><input type="checkbox" checked={row.lineIds.includes(line.id)} onChange={(event) => change({ ...row, lineIds: event.target.checked ? [...row.lineIds, line.id] : row.lineIds.filter((id) => id !== line.id) })} /> {line.description} · {line.quantity} {line.unit}</label>)}</fieldset> : null}
        <label>Basis or approved responsibility<input value={row.rationale} onChange={(event) => change({ ...row, rationale: event.target.value })} placeholder="Why this treatment applies" /></label>
        {row.treatment === "Unresolved" || row.treatment === "Excluded" ? <label>Required follow-up<input value={row.followUp} onChange={(event) => change({ ...row, followUp: event.target.value })} placeholder="Decision or Define revision needed" /></label> : null}
        {row.treatment === "Excluded" && obligation.confirmed ? <p className={styles.issue}>Approved scope cannot be removed by an estimate selection. Govern a Define revision or deviation first.</p> : null}
      </article>;
    })}
    <h3>Installation-effort scenarios</h3><p>Only the selected labor line varies. Enter a measured unit count and person-hours per unit; cable length, link count, strands and crew-hours are distinct units.</p>
    <div className={styles.columns}>
      <label>Installation labor line<select value={basis.installationScenario?.lineId ?? ""} onChange={(event) => onChange({ ...input, romBasis: { ...basis, installationScenario: { lineId: event.target.value, units: 0, unit: "link", lowHoursPerUnit: 0, baseHoursPerUnit: 0, highHoursPerUnit: 0, quantitySource: "", rationale: "" } } })}><option value="">Select labor line</option>{input.lines.filter((line) => line.category === "labor" && line.unit === "person-hour").map((line) => <option value={line.id} key={line.id}>{line.description}</option>)}</select></label>
      {(["units", "unit", "lowHoursPerUnit", "baseHoursPerUnit", "highHoursPerUnit", "quantitySource", "rationale"] as const).map((key) => <label key={key}>{({ units: "Count of units", unit: "Unit (for example link)", lowHoursPerUnit: "Low person-hours per unit", baseHoursPerUnit: "Base person-hours per unit", highHoursPerUnit: "High person-hours per unit", quantitySource: "Quantity source and status", rationale: "Scenario rationale" })[key]}<input type={typeof basis.installationScenario?.[key] === "number" || ["units", "lowHoursPerUnit", "baseHoursPerUnit", "highHoursPerUnit"].includes(key) ? "number" : "text"} min={key === "unit" ? undefined : "0"} step="any" value={basis.installationScenario?.[key] ?? ""} onChange={(event) => onChange({ ...input, romBasis: { ...basis, installationScenario: { lineId: basis.installationScenario?.lineId ?? "", units: basis.installationScenario?.units ?? 0, unit: basis.installationScenario?.unit ?? "link", lowHoursPerUnit: basis.installationScenario?.lowHoursPerUnit ?? 0, baseHoursPerUnit: basis.installationScenario?.baseHoursPerUnit ?? 0, highHoursPerUnit: basis.installationScenario?.highHoursPerUnit ?? 0, quantitySource: basis.installationScenario?.quantitySource ?? "", rationale: basis.installationScenario?.rationale ?? "", [key]: ["units", "lowHoursPerUnit", "baseHoursPerUnit", "highHoursPerUnit"].includes(key) ? Number(event.target.value) : event.target.value } } })} /></label>)}
    </div>
    {scenarios ? <div className={styles.facts}>{(["low", "base", "high"] as const).map((key) => <span key={key}><b>{key.toUpperCase()} ROM</b>{formatMinor(scenarios[key].proposedPriceMinor, scenarios[key].currency)} · included cost {formatMinor(scenarios[key].includedCostMinor, scenarios[key].currency)}</span>)}</div> : null}
    <h3>Customer-facing ROM basis</h3><p>This will carry into the separately reviewed customer proposal. It is indicative pricing, not a fixed-price award or final engineering release.</p>
    {(["scope", "assumptions", "exclusions", "informationNeeded", "reviewDate", "designValidation"] as const).map((key) => <label key={key}>{({ scope: "Indicative scope", assumptions: "Quantity and delivery assumptions", exclusions: "Explicit exclusions", informationNeeded: "Information still required", reviewDate: "Validity or review date", designValidation: "What detailed Design must validate" })[key]}<input type={key === "reviewDate" ? "date" : "text"} value={basis.communication?.[key] ?? ""} onChange={(event) => onChange({ ...input, romBasis: { ...basis, communication: { scope: basis.communication?.scope ?? "", assumptions: basis.communication?.assumptions ?? "", exclusions: basis.communication?.exclusions ?? "", informationNeeded: basis.communication?.informationNeeded ?? "", reviewDate: basis.communication?.reviewDate ?? "", designValidation: basis.communication?.designValidation ?? "", [key]: event.target.value } } })} /></label>)}
    {issues.length ? <div role="status">{issues.map((issue) => <p className={styles.issue} key={issue}>{issue}</p>)}</div> : <p>Coverage and scenario inputs are complete for ROM review, subject to the authoritative command checks.</p>}
  </section>;
}
