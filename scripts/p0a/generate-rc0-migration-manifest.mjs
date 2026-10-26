import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const directory = join(root, "supabase", "migrations");
const outputDirectory = join(root, "docs", "release");
const releasedCommit = "4cf881b506def45564040d767292c5c8c4ecbe48";
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const excluded = files.filter((name) => /-ShawnT13\.sql$/i.test(name));
const included = files.filter((name) => !excluded.includes(name));
const versions = new Set();
const migrations = included.map((filename, index) => {
  const version = filename.split("_")[0];
  if (versions.has(version)) throw new Error(`duplicate migration version: ${version}`);
  versions.add(version);
  const path = `supabase/migrations/${filename}`;
  const sha256 = createHash("sha256").update(readFileSync(join(directory, filename))).digest("hex");
  let releasedTree = false;
  try { execFileSync("git", ["cat-file", "-e", `${releasedCommit}:${path}`], { cwd: root, stdio: "ignore" }); releasedTree = true; }
  catch { /* Local-only migration. */ }
  return { order: index + 1, version, filename, sha256, source: releasedTree ? `origin/main@${releasedCommit}` : "local-phase-lineage@9a0886990bc8d1d2cb4e3a28cbc73672501b7240",
    dependsOn: index ? included[index - 1] : null };
});
const manifest = { format: "d5o-rc0-migration-manifest-v1", baseline: releasedCommit,
  source: "9a0886990bc8d1d2cb4e3a28cbc73672501b7240", ordering: "lexicographic filename, excluding historical duplicate copy",
  excluded: excluded.map((filename) => ({ filename, reason: "duplicate version 0016; existing disposable runtime excludes -ShawnT13.sql" })), migrations };
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "D5O_RC0_MIGRATION_CHECKSUMS.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ included: migrations.length, released: migrations.filter((item) => item.source.startsWith("origin")).length,
  local: migrations.filter((item) => item.source.startsWith("local")).length, excluded }));
