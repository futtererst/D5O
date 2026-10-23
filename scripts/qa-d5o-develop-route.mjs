import assert from "node:assert/strict";
import { parseDevelopRoute, writeDevelopRoute } from "../components/d5o/platform/develop-route.ts";

const params = (value) => new URLSearchParams(value);
const roundTrip = (route) => {
  const query = params("workspace=rybex&developQ=fictional&developDisplay=board");
  writeDevelopRoute(query, route);
  assert.deepEqual(parseDevelopRoute(query), route);
  return query;
};

const pipeline = roundTrip({ destination: "pipeline" });
assert.equal(pipeline.get("record"), null);
const workspace = roundTrip({ destination: "workspace", recordId: "rybex-work-a" });
assert.equal(workspace.get("focus"), null);
for (const focus of ["pricing", "proposal", "solution-review", "design-handoff-receive"]) {
  const task = { destination: "task", recordId: "rybex-work-a", focus, revision: 2 };
  const serialized = roundTrip(task);
  assert.equal(serialized.get("developQ"), "fictional");
  // Older exact My Work links identify task by focus without developPanel.
  serialized.delete("developPanel");
  assert.deepEqual(parseDevelopRoute(serialized), task);
}
assert.deepEqual(parseDevelopRoute(params("view=develop&developPanel=pipeline&record=stale&focus=pricing&sourceRevision=2")), { destination: "pipeline" });
for (const query of [
  "view=develop&developPanel=task&record=rybex-work-a",
  "view=develop&developPanel=task&focus=pricing&sourceRevision=2",
  "view=develop&record=rybex-work-a&focus=pricing",
  "view=develop&record=rybex-work-a&focus=unknown&sourceRevision=2",
  "view=develop&record=rybex-work-a&focus=proposal&sourceRevision=NaN",
  "view=develop&developPanel=workspace",
]) assert.deepEqual(parseDevelopRoute(params(query)), { destination: "invalid-task" }, query);
assert.deepEqual(parseDevelopRoute(params("view=develop&record=rybex-work-b")), { destination: "workspace", recordId: "rybex-work-b" });
console.log("Develop route round trips and invalid-link boundaries passed");
