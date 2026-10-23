import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const out = resolve(root, "docs/architecture/evidence/p0a-boundary-inventory.json");
const paths = ["app", "lib/d5o", "supabase/migrations", "scripts"]
  .flatMap((directory) => walk(resolve(root, directory)))
  .filter((path) => /\.(?:ts|tsx|sql|mjs)$/.test(path) && !path.includes("ShawnT13"));
const rows = [];
const source = (file, line) => `${relative(root, file).replaceAll("\\", "/")}:${line}`;
const linesAt = (body, index) => body.slice(0, index).split("\n").length;
const add = (surface, file, body, index, symbol, type) => {
  const region = body.slice(index, Math.min(body.length, index + 4500));
  const workspace = /workspace[_-]?(?:id|key)|p_workspace|tenant[_-]?id|tenantId/i.test(region);
  const membership = /membership|hostedPrototypeContext|actor_v1|getRequestContext|auth\.getUser|auth\.uid\(\)/i.test(region);
  const elevated = /service.role|service_role|createRybexSupabaseAdminClient|createRybexSupabaseService|security definer/i.test(region);
  const rls = /row level security|create policy|FORCE ROW LEVEL/i.test(region);
  const api = /app\/api\//.test(source(file, index));
  rows.push({ surface, type, source: source(file, linesAt(body, index)), symbol,
    tenantResolution: workspace ? "workspace/tenant identifier referenced; verify derivation" : "not identified statically",
    authentication: membership ? "identity/membership referenced; verify per request" : "not identified statically",
    authorization: membership ? "guard referenced; verify role/resource" : "unverified",
    enforcement: type === "table" || type === "policy" ? (rls ? "RLS/policy source" : "database grants/RLS unverified") : api ? "API plus downstream checks to verify" : "downstream boundary to verify",
    privilegedAccess: elevated,
    risk: elevated ? "elevated authority needs actor and tenant recheck" : workspace ? "forged tenant or record identifier" : "missing tenant context or unscoped access",
    test: "runtime positive and negative coverage not yet mapped",
    status: "partial" });
};
for (const file of paths) {
  const name = relative(root, file).replaceAll("\\", "/");
  const body = readFileSync(file, "utf8");
  if (name.startsWith("app/api/") && name.endsWith("/route.ts")) {
    for (const match of body.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g))
      add(`${name} ${match[1]}`, file, body, match.index, match[1], "api-route");
  }
  if (name.startsWith("app/") && body.includes('"use server"')) {
    for (const match of body.matchAll(/export\s+async\s+function\s+(\w+)\b/g))
      add(`${name} ${match[1]}`, file, body, match.index, match[1], "server-action");
  }
  if (name.startsWith("lib/d5o/") && /\.rpc\(|\.from\(|createRybexSupabaseAdminClient|createRybexSupabaseServerClient|storage\.|readFileSync|writeFileSync|fetch\(/.test(body)) {
    for (const match of body.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\b/g))
      add(`${name} ${match[1]}`, file, body, match.index, match[1], "service-function");
  }
  if (name.startsWith("supabase/migrations/")) {
    for (const match of body.matchAll(/(?:create\s+(?:or\s+replace\s+)?function\s+([\w.]+)|create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)|create\s+policy\s+"?([\w-]+)"?)/gi))
      add(match[1] ?? match[2] ?? match[3], file, body, match.index, match[1] ?? match[2] ?? match[3], match[1] ? "rpc-function" : match[2] ? "table" : "policy");
    if (/storage\.buckets|storage\.objects|storage\.create_signed_url/i.test(body))
      add(`${name} storage`, file, body, body.search(/storage\.(?:buckets|objects|create_signed_url)/i), "storage", "storage-policy");
  }
  if (name.startsWith("scripts/") && /cron|schedule|notification|export|background|queue|outbox/i.test(name) && /workspace|tenant/i.test(body))
    add(name, file, body, 0, "script", "background-or-test");
}
rows.sort((a, b) => a.source.localeCompare(b.source) || a.type.localeCompare(b.type));
const result = { schemaVersion: 1, baseline: process.env.P0A_BASELINE_SHA ?? "record-in-report",
  methodology: "Static candidate enumeration; every row remains partial until manually mapped and runtime tested.", count: rows.length, rows };
mkdirSync(resolve(root, "docs/architecture/evidence"), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ count: rows.length, output: relative(root, out).replaceAll("\\", "/") }));

function walk(directory) {
  try { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".tmp")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }); } catch { return []; }
}
