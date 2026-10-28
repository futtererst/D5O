import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  .replace(/^import[^;]*;\s*/gm, "");
const stub = `class NextResponse {
  constructor(body, options = {}) { this.body = body; this.status = options.status ?? 200;
    this.headers = { set() {} }; }
  static next() { return new NextResponse(null); }
  static redirect() { return new NextResponse(null, { status: 307 }); }
  static json(body, options = {}) { return new NextResponse(body, options); }
}\n`;
const compiled = ts.transpileModule(stub + source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { proxy } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const names = ["RYBEXOS_RUNTIME_MODE", "D5O_HOSTED_ENABLED", "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const checked = [];
try {
  process.env.RYBEXOS_RUNTIME_MODE = "production";
  process.env.D5O_HOSTED_ENABLED = "1";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const request = (pathname) => {
    const nextUrl = new URL(pathname, "https://example.invalid");
    nextUrl.clone = () => new URL(nextUrl);
    return { nextUrl, url: nextUrl.toString() };
  };
  for (const path of ["/api/d5o-platform/provisioning", "/api/d5o-platform/initial-admin-accept"]) {
    const result = await proxy(request(path));
    assert.equal(result.status, 401, path);
    checked.push({ path, expected: "passes_hosted_guard_then_requires_auth", status: result.status });
  }
  for (const path of ["/work/initial-invitation", "/work/onboarding", "/work/connected-work",
    "/work/customer/fictional", "/work/customer/fictional/assignments",
    "/work/customer/fictional/field", "/work/customer/fictional/deploy"]) {
    const result = await proxy(request(path));
    assert.equal(result.status, 307, path);
    checked.push({ path, expected: "passes_hosted_guard_then_redirects_to_sign_in", status: result.status });
  }
  for (const path of ["/pipeline", "/api/work/catalog", "/api/evidence/finalize",
    "/api/d5o-platform/unknown", "/api/d5o-platform/provisioning/extra",
    "/work/customerish/fictional", "/work/legacy", "/field-execution"]) {
    const result = await proxy(request(path));
    assert.equal(result.status, 503, path);
    checked.push({ path, expected: "blocked_by_hosted_guard", status: result.status });
  }
} finally {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
console.log(JSON.stringify({ format: "d5o-rc18-hosted-proxy-v1", checks: checked,
  passed: checked.length, failed: 0, synthetic: true }));
