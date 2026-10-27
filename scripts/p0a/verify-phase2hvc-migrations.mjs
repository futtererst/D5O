import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const root=resolve(process.cwd());
const migrationDir=join(root,"supabase","migrations");
const baseline=JSON.parse(readFileSync(join(root,"docs","release",
  "D5O_RC0_MIGRATION_CHECKSUMS.json"),"utf8"));
const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");
const names=readdirSync(migrationDir).filter((name)=>name.endsWith(".sql")).sort();
const excluded=new Set(baseline.excluded.map((item)=>item.filename));
const executable=names.filter((name)=>!excluded.has(name));
assert.equal(baseline.migrations.length,234);
assert.equal(executable.length,235);
for(const [index,item] of baseline.migrations.entries()) {
  assert.equal(item.filename,executable[index],`ordering:${index+1}`);
  assert.equal(item.sha256,hash(readFileSync(join(migrationDir,item.filename))),
    `historical_checksum:${item.filename}`);
}
const forward=executable.at(-1);
assert.equal(forward,"20261027085730_d5o_operate_acceptance_one_time_guard.sql");
const versions=new Map();
for(const name of executable) {
  const version=name.split("_")[0];
  assert(!versions.has(version),`duplicate_version:${version}`);
  versions.set(version,name);
}
const applicationCommit=process.env.D5O_APPLICATION_COMMIT;
assert.match(applicationCommit??"",/^[0-9a-f]{40}$/i,"application_commit_required");
const result={format:"d5o-phase2hvc-migration-manifest-v1",applicationCommit,
  rc0ApplicationCommit:"3710ecace04e54769b5761da83f12594562e95b3",
  rc0ManifestSha256:hash(readFileSync(join(root,"docs","release",
    "D5O_RC0_MIGRATION_CHECKSUMS.json"))),
  historicalCount:234,totalExecutable:executable.length,
  excluded:[...baseline.excluded],historicalChecksumsMatch:true,
  migrations:executable.map((filename,index)=>({order:index+1,
    version:filename.split("_")[0],filename,
    sha256:hash(readFileSync(join(migrationDir,filename))),
    dependsOn:index?executable[index-1]:null,
    source:index<234?baseline.migrations[index].source:applicationCommit}))};
const output=join(root,"docs","release","evidence","D5O_PHASE2HVC_MIGRATION_CHECKSUMS.json");
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({output,totalExecutable:235,historicalChecksumsMatch:true,
  newMigration:forward,newSha256:result.migrations.at(-1).sha256}));
