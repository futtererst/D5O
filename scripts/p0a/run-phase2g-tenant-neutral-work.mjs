// Reuse the connected Phase 2F disposable journey, then run the Phase 2G
// projection and authenticated customer Work route assertions.
process.env.D5O_PHASE2G = "1";
await import("./run-phase2f-connected-journey.mjs");
