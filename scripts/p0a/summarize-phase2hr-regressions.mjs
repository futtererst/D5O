import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const inherited = read("docs/architecture/evidence/phase2hr-inherited/summary.json");
const correctedPhase2c = read("docs/architecture/evidence/phase2hr-inherited/phase2c-corrected.json");
const design = read("docs/architecture/evidence/phase2hr-design-browser-results.json");
const suites = Object.fromEntries(Object.entries(inherited.suites).map(([name, value]) => [name, {
  exitCode: value.exitCode, summary: value.summary,
  evidence: `docs/architecture/evidence/phase2hr-inherited/${name}.json`
}]));
suites.phase2c = {
  ...suites.phase2c,
  correctedRerun: correctedPhase2c.summary,
  correctedRerunEvidence: "docs/architecture/evidence/phase2hr-inherited/phase2c-corrected.json",
  correction: "Restored Connected Work creation-page confirmation after an incompatible redirect"
};
const result = {
  baseline: "f53aa89192b776221067cc6a761248e87259f82e",
  generatedAt: new Date().toISOString(),
  suites,
  staticChecks: inherited.staticChecks,
  phase2hr: {
    summary: design.summary,
    authenticatedDesignControlInvocations: design.designActions?.length ?? 0,
    evidence: "docs/architecture/evidence/phase2hr-design-browser-results.json"
  },
  blocked: ["Original sealed M1 RUN-MANIFEST.json absent",
    "Original historical connected pilot fixture absent"],
  cleanup: { phase2hr: design.cleanup?.clean === true,
    inherited: Object.fromEntries(Object.entries(inherited.suites).map(([name, value]) => [name,
      value.summary?.cleanupVerified === true])) }
};
writeFileSync("docs/architecture/evidence/phase2hr-regression-results.json",
  JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({phase2hr: result.phase2hr.summary,
  suites: Object.fromEntries(Object.entries(result.suites).map(([name, value]) =>
    [name, value.correctedRerun ?? value.summary])), blocked: result.blocked}));
