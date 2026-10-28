// Timed fresh offline recovery of the post-upgrade encrypted checkpoint.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const container="d5o-rc7-recovery-db";
const dir="C:\\Users\\futte\\AppData\\Local\\D5O-RC6-Protected";
const started=performance.now();
function run(program,args,env={}){
  const r=spawnSync(program,args,{encoding:"utf8",env:{...process.env,...env},maxBuffer:1024*1024,timeout:120000});
  if(r.status!==0)throw Error(`offline recovery step failed: ${program} ${args[0]}: ${(r.stderr||"").split(/\r?\n/).find(x=>/ERROR:|Error:/.test(x))||"unknown"}`);
  return r.stdout.trim();
}
if(spawnSync("docker",["inspect",container],{encoding:"utf8"}).status===0)throw Error("recovery container exists");
run("docker",["run","-d","--name",container,"--pull","never","--network","none",
  "-e","POSTGRES_PASSWORD=rc8-local-isolated","public.ecr.aws/supabase/postgres:17.6.1.127"]);
let ready=false;for(let i=0;i<30;i++){
  if(spawnSync("docker",["exec",container,"pg_isready","-U","postgres","-d","postgres"],{encoding:"utf8"}).status===0){ready=true;break}
  await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error("offline recovery database not ready");
// The image briefly accepts connections before its initialization restart.
// Wait for that restart to finish before running the first restore command.
await new Promise(r=>setTimeout(r,6000));
let stable=false;for(let i=0;i<15;i++){
  if(spawnSync("docker",["exec",container,"psql","-U","supabase_admin","-d","postgres","-At","-c","select 1"],{encoding:"utf8"}).status===0){stable=true;break}
  await new Promise(r=>setTimeout(r,1000));
}
if(!stable)throw Error("offline recovery database did not stabilize");
const inspect=JSON.parse(run("docker",["inspect",container]))[0];
if(inspect.HostConfig.NetworkMode!=="none"||Object.keys(inspect.HostConfig.PortBindings||{}).length)throw Error("network isolation failure");
const env={D5O_RC7_CONTAINER:container};
run("node",["scripts/rc7_prepare_local_roles.mjs"],env);
run("node",["scripts/rc7_restore_archive.mjs","schema",`${dir}\\rc8-upgraded-schema.dump.aesgcm`],env);
run("node",["scripts/rc7_restore_auth.mjs",`${dir}\\rc7-auth.jsonl.aesgcm`],env);
run("node",["scripts/rc7_restore_archive.mjs","data",`${dir}\\rc8-upgraded-data.dump.aesgcm`],env);
const storage=JSON.parse(run("node",["scripts/rc7_verify_storage_copy.mjs",dir],env));
const counts=run("docker",["exec",container,"psql","-U","supabase_admin","-d","postgres","-At","-F","|","-c",
  "select (select count(*) from supabase_migrations.schema_migrations),(select count(*) from auth.users),(select count(*) from auth.identities),(select count(*) from d5o_hosted.work_records),(select count(*) from storage.objects),(select count(*) from d5o_hosted.rc8_invitation_bridge_receipts)"]);
if(counts!=="202|25|25|15|23|1")throw Error("recovered post-upgrade counts mismatch");
const sec=run("docker",["exec",container,"psql","-U","supabase_admin","-d","postgres","-At","-F","|","-c",
  "select (select convalidated from pg_constraint where conrelid='d5o_hosted.admin_identity_requests'::regclass and conname='admin_identity_requests_role_check'),(select relrowsecurity from pg_class where oid='d5o_hosted.rc8_invitation_bridge_receipts'::regclass)"]);
if(sec!=="t|t")throw Error("recovered security boundary mismatch");
const result={format:"d5o-rc8-post-upgrade-recovery-v1",isolatedContainer:container,
  networkMode:"none",elapsedSeconds:Math.round((performance.now()-started)/10)/100,
  recoveredLedgerRows:202,recoveredAuthUsers:25,recoveredIdentities:25,recoveredWorkRecords:15,
  recoveredBridgeReceipts:1,privateObjectsVerified:storage.objects,privateBytesVerified:storage.totalBytes,
  metadataAssociationsMatched:storage.restoredMetadataAssociationsMatched,
  roleCheckValidated:true,bridgeReceiptRls:true,
  limitation:"No local Storage API serving or coordinated production DB/Storage checkpoint was established."};
writeFileSync("docs/release/evidence/D5O_RC8_POST_UPGRADE_RECOVERY.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
