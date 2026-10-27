import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const phase2hvc=process.env.D5O_PHASE2HVC_UPGRADE==="1";
const manifest = JSON.parse(readFileSync(join(root, "docs/release/D5O_RC0_MIGRATION_CHECKSUMS.json"), "utf8"));
const pending = phase2hvc
  ? [{version:"20261027085730",filename:"20261027085730_d5o_operate_acceptance_one_time_guard.sql"}]
  : manifest.migrations.filter((item) => item.source.startsWith("local"));
const result = { baseline: manifest.baseline, source: manifest.source, pending: pending.map((item) => item.filename),
  markerPreserved: false, workPinPreserved: false, auditPreserved: false,
  appliedVersions: [], cleanup: null, error: null };
let runtime;
function execute(command, args, input) {
  const run = spawnSync(command, args, { cwd: root, input, encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`${command} ${args.join(" ")}: ${String(run.stderr || run.stdout).slice(-2000)}`);
  return run.stdout.trim();
}
function sql(query) {
  return execute("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], query);
}
try {
  runtime = await createP0aRuntime(root, { migrationCutoff: phase2hvc?"20261027":"20261023" });
  const key = `rc0_upgrade_${randomUUID().replaceAll("-", "")}`;
  const id = randomUUID();
  sql(`insert into d5o_hosted.workspaces(id,workspace_key,display_name) values ('${id}','${key}','RC0 synthetic pre-upgrade tenant');`);
  const before = sql(`select workspace_key || '|' || display_name || '|' || status from d5o_hosted.workspaces where id='${id}';`);
  assert.equal(before, `${key}|RC0 synthetic pre-upgrade tenant|active`);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url && service,"disposable_auth_binding_missing");
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({email:`${key}@example.test`,password:`Rc0${randomUUID()}!`,email_confirm:true});
  assert(!created.error && created.data.user?.id,created.error?.message);
  const actorId = created.data.user.id;
  const tenantId = randomUUID(), versionId = randomUUID(), workId = randomUUID(), membershipId = randomUUID();
  sql(`begin;
    insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values ('${tenantId}','${id}','active');
    insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json)
      values ('${versionId}','${tenantId}',1,'draft',repeat('a',64),'{"workTypes":[{"key":"rc0_legacy_work"}]}');
    insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
      values ('${versionId}','rc0_legacy_work','RC0 legacy Work','active');
    update d5o_hosted.configuration_versions set status='published',effective_from=now() where id='${versionId}';
    insert into d5o_hosted.memberships(id,workspace_id,actor_user_id,role,status)
      values ('${membershipId}','${id}','${actorId}','admin','active');
    insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,
      configuration_digest,work_type_key,title,created_by)
      values ('${workId}','${id}','${tenantId}','${versionId}',repeat('a',64),'rc0_legacy_work',
        'RC0 historical pinned Work','${actorId}');
    insert into d5o_hosted.work_events(workspace_id,work_id,event_type,record_version,actor_user_id,
      membership_id,authority_role,configuration_version_id,configuration_digest,payload)
      values ('${id}','${workId}','work_created',1,'${actorId}','${membershipId}','admin',
        '${versionId}',repeat('a',64),'{}');
    insert into d5o_hosted.work_command_receipts(workspace_id,command_id,request_fingerprint,work_id,result)
      values ('${id}','rc0-historical-work-receipt','rc0-fixture','${workId}','{"status":"accepted"}');
    commit;`);
  const pinnedBefore = sql(`select configuration_version_id::text || '|' || configuration_digest || '|' ||
    title from d5o_hosted.work_records where id='${workId}';`);
  const historyBefore = sql(`select (select count(*) from d5o_hosted.work_events where work_id='${workId}')::text || '|' ||
    (select count(*) from d5o_hosted.work_command_receipts where work_id='${workId}')::text;`);
  assert.equal(historyBefore,"1|1");
  for (const item of pending) copyFileSync(join(root, "supabase", "migrations", item.filename),
    join(runtime.projectDir, "supabase", "migrations", item.filename));
  execute(process.execPath, [join(root, "node_modules", "supabase", "dist", "supabase.js"), "db", "push", "--local",
    "--workdir", runtime.projectDir, "--yes"]);
  const after = sql(`select workspace_key || '|' || display_name || '|' || status from d5o_hosted.workspaces where id='${id}';`);
  assert.equal(after, before);
  result.markerPreserved = true;
  const pinnedAfter = sql(`select configuration_version_id::text || '|' || configuration_digest || '|' ||
    title from d5o_hosted.work_records where id='${workId}';`);
  const historyAfter = sql(`select (select count(*) from d5o_hosted.work_events where work_id='${workId}')::text || '|' ||
    (select count(*) from d5o_hosted.work_command_receipts where work_id='${workId}')::text;`);
  result.workPinPreserved = pinnedAfter === pinnedBefore;
  result.auditPreserved = historyAfter === historyBefore;
  assert(result.workPinPreserved && result.auditPreserved,"historical_work_or_audit_changed");
  result.fixture = {workspaceId:id,actorId,workId,configurationVersionId:versionId,
    before:{tenant:before,work:pinnedBefore,history:historyBefore},
    after:{tenant:after,work:pinnedAfter,history:historyAfter}};
  result.appliedVersions = sql(`select version from supabase_migrations.schema_migrations where version >= '${phase2hvc?"20261027":"20261023"}' order by version;`).split("\n").filter(Boolean);
  assert.deepEqual(result.appliedVersions, pending.map((item) => item.version));
  if(phase2hvc) {
    result.boundary=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
      'publicDefiner',p.prosecdef,'publicSearchPath',p.proconfig,
      'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'priorAuthenticatedExecute',has_function_privilege('authenticated',
        'd5o_hosted.d5o_hosted_operate_command_phase2hvc_prior_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure,'EXECUTE'),
      'operateRls',(select relrowsecurity from pg_class where oid='d5o_hosted.connected_operate_states'::regclass),
      'evidenceRls',(select relrowsecurity from pg_class where oid='d5o_hosted.customer_decision_evidence'::regclass))::text
      from pg_proc p where p.oid='public.d5o_hosted_operate_command_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure;`));
    assert.equal(result.boundary.publicDefiner,true);
    assert(result.boundary.publicSearchPath.some((item)=>item==="search_path=\"\""),
      "restricted_search_path_missing");
    assert.equal(result.boundary.authenticatedExecute,true);
    assert.equal(result.boundary.anonExecute,false);
    assert.equal(result.boundary.serviceExecute,false);
    assert.equal(result.boundary.priorAuthenticatedExecute,false);
    assert.equal(result.boundary.operateRls,true);
    assert.equal(result.boundary.evidenceRls,true);
  }
} catch (error) { result.error = String(error); }
finally {
  if (runtime) result.cleanup = cleanupP0aRuntime(runtime);
  writeFileSync(join(root, process.env.D5O_UPGRADE_RESULT_PATH || "docs/release/D5O_RC0_UPGRADE_SMOKE.json"),
    `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ passed: !result.error && result.markerPreserved && result.workPinPreserved &&
    result.auditPreserved && result.cleanup?.clean,
    applied: result.appliedVersions.length, markerPreserved: result.markerPreserved,
    workPinPreserved: result.workPinPreserved, auditPreserved: result.auditPreserved,
    cleanup: result.cleanup, error: result.error }));
}
if (result.error || !result.cleanup?.clean) process.exitCode = 1;
