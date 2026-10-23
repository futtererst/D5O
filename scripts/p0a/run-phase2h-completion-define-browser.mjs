// The cumulative fixture still performs later-phase decisions through RPCs.
// This variant qualifies only the Define draft and decision browser gate.
process.env.D5O_PHASE2G = "1";
process.env.D5O_PHASE2H_COMPLETION = "1";
await import("./run-phase2f-connected-journey.mjs");
