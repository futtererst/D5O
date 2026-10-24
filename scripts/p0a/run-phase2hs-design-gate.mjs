// Executes Gate A in its own disposable project, without the weekday-only
// downstream field-start journey.
process.env.D5O_PHASE2G = "1";
process.env.D5O_PHASE2HS_GATE_A = "1";
await import("./run-phase2f-connected-journey.mjs");
