import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

let runtime;
try {
  runtime = await createP0aRuntime(process.cwd());
  console.log(JSON.stringify({ migrations: ["20261024150000_phase2ht_workforce_qualification_expiry",
    "20261024151000_phase2ht_current_worker_assignment"],
    projectId: runtime.projectId, started: true }));
} finally {
  if (runtime) console.log(JSON.stringify({ cleanup: cleanupP0aRuntime(runtime) }));
}
