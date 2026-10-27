// Fresh isolated recovery from encrypted database/Auth/Storage checkpoint.
// This does not start a Storage API service or claim end-to-end object serving.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const container = "d5o-rc7-recovery-db";
const dir = "C:\\Users\\futte\\AppData\\Local\\D5O-RC6-Protected";
const started = performance.now();
const run = (program,args,env={}) => {
  const p=spawnSync(program,args,{encoding:"utf8",env:{...process.env,...env},maxBuffer:1024*1024,timeout:120000});
  if(p.status!==0) throw Error(`recovery step failed: ${program} ${args[0]}: ${(p.stderr||"").split(/\r?\n/).find(x=>/ERROR:|Error:/.test(x))||"unknown"}`);
  return p.stdout.trim();
};
const existing=spawnSync("docker",["inspect",container],{encoding:"utf8"});
if(existing.status===0) throw Error("recovery container already exists");
run("docker",["run","-d","--name",container,"--pull","never","--network","none",
  "-e","POSTGRES_PASSWORD=rc7-local-isolated","public.ecr.aws/supabase/postgres:17.6.1.127"]);
let ready=false;
for(let i=0;i<30;i++) {
  const p=spawnSync("docker",["exec",container,"pg_isready","-U","postgres","-d","postgres"],{encoding:"utf8"});
  if(p.status===0){ready=true;break;}
  await new Promise(r=>setTimeout(r,1000));
}
if(!ready) throw Error("recovery PostgreSQL did not become ready");
const inspect=JSON.parse(run("docker",["inspect",container]))[0];
if(inspect.HostConfig.NetworkMode!=="none"||Object.keys(inspect.HostConfig.PortBindings||{}).length)
  throw Error("recovery container network isolation failed");
const env={D5O_RC7_CONTAINER:container};
run("node",["scripts/rc7_prepare_local_roles.mjs"],env);
run("node",["scripts/rc7_restore_archive.mjs","schema",`${dir}\\rc7-schema.dump.aesgcm`],env);
run("node",["scripts/rc7_restore_auth.mjs",`${dir}\\rc7-auth.jsonl.aesgcm`],env);
run("node",["scripts/rc7_restore_archive.mjs","data",`${dir}\\rc7-database.dump.aesgcm`],env);
const storage=JSON.parse(run("node",["scripts/rc7_verify_storage_copy.mjs",dir],env));
const counts=run("docker",["exec",container,"psql","-U","supabase_admin","-d","postgres","-At","-F","|","-c",
  "select (select count(*) from supabase_migrations.schema_migrations),(select count(*) from auth.users),(select count(*) from auth.identities),(select count(*) from d5o_hosted.work_records),(select count(*) from storage.objects)"]);
if(counts!=="177|25|25|15|23") throw Error("recovery record-count mismatch");
const seconds=Math.round((performance.now()-started)/1000*100)/100;
const result={format:"d5o-rc7-local-recovery-rehearsal-v1",isolatedContainer:container,
  networkMode:"none",elapsedSeconds:seconds,restoredCounts:{ledger:177,authUsers:25,authIdentities:25,workRecords:15,storageMetadataObjects:23},
  encryptedPrivateObjectsVerified:storage.objects,encryptedPrivateBytesVerified:storage.totalBytes,
  storageMetadataAssociationsMatched:storage.restoredMetadataAssociationsMatched,
  limitation:"No Storage API byte-serving restore or atomic production DB/Storage checkpoint was established."};
writeFileSync("docs/release/evidence/D5O_RC7_LOCAL_RECOVERY_REHEARSAL.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
