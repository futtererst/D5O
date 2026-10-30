import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("components/d5o/customer-work/operate-handoff-authority.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports }, { filename: "operate-handoff-authority.ts" });
const { canLinkAcceptedHandoff } = exports;

const adminReceipt = { receipt: "Accepted", receivingRole: "admin", receivedByActorId: "admin-a" };
assert.equal(canLinkAcceptedHandoff(adminReceipt, "admin", "admin-a"), true);
assert.equal(canLinkAcceptedHandoff(adminReceipt, "admin", "admin-b"), false);
assert.equal(canLinkAcceptedHandoff(adminReceipt, "operations_leader", "admin-a"), false);
assert.equal(canLinkAcceptedHandoff({ ...adminReceipt, receipt: "Awaiting" }, "admin", "admin-a"), false);
assert.equal(canLinkAcceptedHandoff({ receipt: "Accepted", receivedByActorId: "ops-a" }, "operations_leader", "ops-a"), true);
console.log("Configured Operate handoff authority passed.");
