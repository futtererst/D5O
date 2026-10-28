// Execute frozen proxy routing and proof-path guards with synthetic environment only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const proxySource = readFileSync("proxy.ts", "utf8").replace(/^import[^;]*;\s*/gm, "");
const responseStub = `class NextResponse { constructor(body, options={}) { this.body=body; this.status=options.status||200; } static next(){return new NextResponse('',{status:200})} static redirect(){return new NextResponse('',{status:307})} }\n`;
const compiled = ts.transpileModule(responseStub + proxySource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { proxy } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const oldMode = process.env.RYBEXOS_RUNTIME_MODE;
const oldHosted = process.env.D5O_HOSTED_ENABLED;
process.env.RYBEXOS_RUNTIME_MODE = "production";
process.env.D5O_HOSTED_ENABLED = "1";
const results = [];
try {
  for (const pathname of ["/pipeline", "/pipeline/new", "/api/work/catalog",
                          "/api/evidence/finalize", "/closeout", "/field-execution"]) {
    const response = await proxy({nextUrl:{pathname},url:"https://example.invalid"+pathname});
    assert.equal(response.status, 503, pathname);
    results.push({path:pathname, status:response.status});
  }
} finally {
  if (oldMode === undefined) delete process.env.RYBEXOS_RUNTIME_MODE;
  else process.env.RYBEXOS_RUNTIME_MODE = oldMode;
  if (oldHosted === undefined) delete process.env.D5O_HOSTED_ENABLED;
  else process.env.D5O_HOSTED_ENABLED = oldHosted;
}
const proof = readFileSync("lib/d5o/work-record/server.ts", "utf8");
assert.match(proof,/M1_PROOF_ENABLED !== "1"/);
assert.match(proof,/RYBEXOS_RUNTIME_MODE !== "test"/);
const pipeline = readFileSync("lib/d5o/opportunities/supabase-repository.ts", "utf8");
assert.match(pipeline,/getRuntimeMode\(\) !== "production" && canCreateSupabaseServerClient\(\)/);
const work = readFileSync("app/work/page.tsx", "utf8");
assert.match(work,/if \(process\.env\.D5O_HOSTED_ENABLED === "1"\) \{/);
assert.ok(work.indexOf("await hostedConfigurationInventory(workspace)") < work.indexOf("assertProofEnvironment();"));
const result={format:"d5o-rc10-hosted-route-contract-v1",synthetic:true,
  blockedRoutes:results,proofPathGuard:"test-only",pipelineDatabaseAccessInProduction:"disabled",
  hostedWorkUses:"hostedConfigurationInventory",passed:true};
writeFileSync("docs/release/evidence/D5O_RC10_HOSTED_ROUTE_CONTRACT.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({blockedRoutes:results.length,passed:true}));
