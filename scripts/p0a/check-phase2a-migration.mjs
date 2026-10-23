import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

let runtime;
try {
  runtime = await createP0aRuntime(process.cwd());
  console.log(JSON.stringify({ migration: "applied", projectId: runtime.projectId }));
} finally {
  if (runtime) console.log(JSON.stringify({ cleanup: cleanupP0aRuntime(runtime) }));
}
