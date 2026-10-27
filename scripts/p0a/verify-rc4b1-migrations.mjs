import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root=resolve(process.cwd());
const directory=join(root,"supabase","migrations");
const baselinePath=join(root,"docs","release","evidence",
  "D5O_PHASE2HVC_MIGRATION_CHECKSUMS.json");
const baseline=JSON.parse(readFileSync(baselinePath,"utf8"));
const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");
const excluded=new Set(baseline.excluded.map((item)=>item.filename));
const executable=readdirSync(directory).filter((name)=>name.endsWith(".sql") &&
  !excluded.has(name)).sort();
assert.equal(baseline.migrations.length,235,"existing_manifest_count");
assert.equal(executable.length,236,"forward_migration_count");
for(const [index,item] of baseline.migrations.entries()) {
  assert.equal(executable[index],item.filename,`migration_order:${index+1}`);
  assert.equal(hash(readFileSync(join(directory,item.filename))),item.sha256,
    `migration_checksum:${item.filename}`);
}
const forward=executable.at(-1);
assert.equal(forward,"20261027190000_d5o_field_fact_latest_permit_order.sql");
const versions=executable.map((name)=>name.split("_")[0]);
assert.equal(new Set(versions).size,versions.length,"duplicate_migration_version");
const result={format:"d5o-rc4b1-migration-manifest-v1",
  baselineManifestSha256:hash(readFileSync(baselinePath)),
  existingMigrations:235,existingChecksumsMatch:true,totalExecutable:236,
  excluded:baseline.excluded,
  migrations:executable.map((filename,index)=>({order:index+1,
    filename,version:versions[index],sha256:hash(readFileSync(join(directory,filename))),
    dependsOn:index?executable[index-1]:null,
    source:index<235?"RC4-B existing manifest":"RC4-B.1 forward correction"}))};
const output=join(root,"docs","release","evidence","D5O_RC4B1_MIGRATION_CHECKSUMS.json");
writeFileSync(output,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({output,existingMigrations:235,existingChecksumsMatch:true,
  totalExecutable:236,newMigration:forward,sha256:result.migrations.at(-1).sha256}));
