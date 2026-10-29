import { verifiedHistoricalReference } from "./m1/qualification/historical-reference.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  check,
  createdTableNames,
  finish,
  migrationsDir,
  readAllConfigurationSql,
  readWorkspaceFile,
  root,
} from "./configuration-foundation-static-utils.mjs";

const results = [];

for (const fileName of [
  "0011_p1_01a_opportunity_intake_qualification.sql",
  "0012_p1_01a_acceptance_remediation.sql",
  "0013_p1_01a_role_accountability_read_model.sql",
  "0014_p1_01a_decision_owner_actions.sql",
  "0015_p1_01b_1_pursuit_authorization.sql",
  "0016_p1_01b_2_bid_submission_outcome.sql",
]) {
  check(results, `${fileName} still exists`, existsSync(join(migrationsDir, fileName)));
}

for (const [label, path, expectedSha256] of [
  ["P1-01B.1", "artifacts/p1-01b-1-human-acceptance-baseline/ACCEPTANCE-MANIFEST.json", "4a9bed1bf140e19e461a222a20dda615da5f0e7dd149493aa40b218ca6f13eee"],
  ["P1-01B.2", "artifacts/p1-01b-2-human-acceptance-baseline/ACCEPTANCE-MANIFEST.json", "218e404b47ac4e6d210a02c83c65852de4449e0718aee1d74b92bd1193a25d56"],
]) {
  const local = join(root, path);
  check(results, `${label} accepted baseline has its pinned historical hash`,
    process.env.M1_QUALIFICATION_MANIFEST
      ? verifiedHistoricalReference(path)
      : existsSync(local) && createHash("sha256").update(readFileSync(local)).digest("hex") === expectedSha256);
}

const configurationSql = readAllConfigurationSql();
const createdTables = createdTableNames(configurationSql);
const forbiddenCreated = createdTables.filter((table) =>
  /p1_01b_3|award_validation|project_readiness|mobilization|configuration_studio|runtime_template_pack_loading/.test(table),
);
check(results, "new migrations do not create P1-01B.3/project readiness/mobilization/Studio tables", forbiddenCreated.length === 0, forbiddenCreated.join(", "));

// The old recommended-next document predates connected D5O. The approved
// production decision supersedes its P1 pause and demo-readiness language.
const releaseDecision = readWorkspaceFile("docs/release/production/D5O_PRODUCTION_RELEASE_DECISION.md").toLowerCase();
check(results, "current decision keeps local acceptance distinct from promotion",
  releaseDecision.includes("local application acceptance qualified") &&
    releaseDecision.includes("no-go for immediate production release"));
check(results, "current decision records the GREEN hosted access gate",
  releaseDecision.includes("green hosted acceptance partial") &&
    releaseDecision.includes("green postgresql uri is unavailable"));
check(results, "current decision withholds migration, deployment and invitations",
  releaseDecision.includes("production migration, deployment, write freeze and customer invitations are not approved or performed"));

finish(results, "Configuration Foundation no-regression static verification");
