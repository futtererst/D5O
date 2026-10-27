process.env.D5O_PHASE2HVC_UPGRADE="1";
process.env.D5O_UPGRADE_RESULT_PATH="docs/release/evidence/D5O_PHASE2HVC_UPGRADE_SMOKE.json";
await import("./run-rc0-upgrade-smoke.mjs");
