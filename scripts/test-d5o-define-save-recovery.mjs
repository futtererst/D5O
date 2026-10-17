import assert from "node:assert/strict";
import { retainedEditsPresent } from "../components/d5o/platform/define-save-recovery.ts";

const before = { status: "Draft", history: [{ event: "Earlier" }], project: { customerContact: "Before", siteArea: "West", requiredDate: "" } };
const draft = { status: "Draft", history: [...before.history, { event: "Investigation updated" }], project: { ...before.project, customerContact: "Avery" } };

assert.equal(retainedEditsPresent(before, draft, {
  status: "Draft", history: [{ event: "Server-projected" }], project: { ...before.project, customerContact: "Avery", siteArea: "East" }
}, true), true, "a committed edit survives unrelated reprojected history and another user's untouched field");
assert.equal(retainedEditsPresent(before, draft, {
  ...before, project: { ...before.project, customerContact: "Blair" }
}, true), false, "a different shared edit cannot be mistaken for the retained edit");

const missingEdit = { ...before, project: { ...before.project, customerContact: "Blair" } };
assert.equal(retainedEditsPresent(before, draft, missingEdit, true), false, "a missing edited value is not treated as committed");
assert.equal(retainedEditsPresent(before, { ...before, project: { ...before.project, customerContact: "" } }, {
  ...before, project: { ...before.project, customerContact: undefined }
}, true), true, "the empty optional input matches its absent server representation");

console.log("define-save-recovery: 4 focused assertions passed");
