// Keep the inherited Phase 2G projection assertions and use browser controls
// for the independent Define decisions in the connected two-tenant journey.
process.env.D5O_PHASE2G = "1";
process.env.D5O_PHASE2H = "1";
await import("./run-phase2f-connected-journey.mjs");
