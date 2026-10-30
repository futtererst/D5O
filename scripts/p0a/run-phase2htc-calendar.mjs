import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root=resolve(process.cwd());
const output=resolve(root,".tmp/phase2htc-calendar-results.json");
const evidence={baseline:"6e28685f44795b1a3f6b19877d575b609be43729",
  environment:"disposable local Supabase/PostgreSQL",tests:[],cleanup:null};
let runtime;
const q=(value)=>`'${String(value).replaceAll("'","''")}'`;
function sql(statement) {
  const done=spawnSync("docker",["exec","-i",runtime.dbContainer,"psql","-U","postgres","-d","postgres",
    "-X","-t","-A","-v","ON_ERROR_STOP=1"],{input:statement,encoding:"utf8",shell:false});
  if(done.status!==0) throw Error(`calendar_sql_failed:${done.stderr.slice(-900)}`);
  return done.stdout.trim();
}
const days=(start,count)=>Array.from({length:count},(_,n)=>{
  const date=new Date(`${start}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+n);
  return date.toISOString().slice(0,10);
});
const cases=[
  {name:"normal business hours",at:"2026-10-26T14:00:00Z",due:"2026-10-26T18:00:00Z",calendar:"Business hours",holidays:[]},
  {name:"missing holiday list",at:"2026-10-26T14:00:00Z",due:"2026-10-26T18:00:00Z",calendar:"Business hours"},
  {name:"empty holiday list",at:"2026-10-26T14:00:00Z",due:"2026-10-26T18:00:00Z",calendar:"Business hours",holidays:[]},
  {name:"invalid calendar structure",at:"2026-10-26T14:00:00Z",error:"service_calendar_invalid",calendar:"Business hours",holidays:"not-an-array"},
  {name:"legacy pinned policy without calendar uses business hours",at:"2026-10-26T14:00:00Z",due:"2026-10-26T18:00:00Z",holidays:[]},
  {name:"foreign tenant calendar identifier",at:"2026-10-26T14:00:00Z",error:"service_calendar_invalid",calendar:"foreign-tenant-calendar-id",holidays:[]},
  {name:"continuous overnight",at:"2026-10-26T23:00:00Z",due:"2026-10-27T03:00:00Z",calendar:"Continuous",holidays:[]},
  {name:"Friday-to-Saturday continuous",at:"2026-10-23T23:00:00Z",due:"2026-10-24T03:00:00Z",calendar:"Continuous",holidays:[]},
  {name:"weekend defers to Monday",at:"2026-10-24T14:00:00Z",due:"2026-10-26T16:00:00Z",calendar:"Business hours",holidays:[]},
  {name:"configured holiday defers to Tuesday",at:"2026-10-26T14:00:00Z",due:"2026-10-27T16:00:00Z",calendar:"Business hours",holidays:["2026-10-26"]},
  {name:"spring daylight-saving transition",at:"2026-03-06T22:00:00Z",due:"2026-03-09T16:00:00Z",calendar:"Business hours",holidays:[]},
  {name:"fall daylight-saving transition",at:"2026-10-30T21:00:00Z",due:"2026-11-02T17:00:00Z",calendar:"Business hours",holidays:[]},
  {name:"no eligible window within guard",at:"2026-10-26T14:00:00Z",error:"sla_calendar_unresolvable",calendar:"Business hours",holidays:days("2026-10-26",122)}
];
try {
  runtime=await createP0aRuntime(root);
  const url=runtime.status.API_URL??runtime.status.SUPABASE_URL;
  const anon=runtime.status.ANON_KEY??runtime.status.PUBLISHABLE_KEY;
  const service=runtime.status.SERVICE_ROLE_KEY??runtime.status.SECRET_KEY;
  assert.equal(url,`http://127.0.0.1:${runtime.ports.api}`);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const email=`phase2htc-calendar-${randomUUID().slice(0,8)}@example.test`;
  const password=randomBytes(24).toString("base64url")+"!";
  const made=await admin.auth.admin.createUser({email,password,email_confirm:true});
  assert(!made.error&&made.data.user);
  const actorId=made.data.user.id;
  const workspaceId=randomUUID(),tenantId=randomUUID(),workspaceKey="calendar_test";
  const templateManifest=JSON.parse(sql(`select v.manifest_json::text
    from d5o_hosted.configuration_template_versions v
    join d5o_hosted.configuration_templates t on t.id=v.template_id
    where t.template_key='service-operations' and v.status='published'
    order by v.version_number desc limit 1;`));
  const templateType=templateManifest.d5oPresentation.phaseContract.workTypes.find((item)=>
    item.workTypeKey==="lifecycle-service");
  assert(templateType,"calendar_template_work_type_missing");
  const records=[];
  const seeds=["begin;",
    `insert into d5o_hosted.workspaces(id,workspace_key,display_name) values (${q(workspaceId)},${q(workspaceKey)},'Fictional calendar qualification');`,
    `insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values (${q(workspaceId)},${q(actorId)},'operations_leader');`,
    `insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values (${q(tenantId)},${q(workspaceId)},'active');`];
  for(let i=0;i<cases.length;i++) {
    const item=cases[i],versionId=randomUUID(),workId=randomUUID();
    const presentation=`${workspaceKey}-${workId.replaceAll("-","")}`;
    const requestId=randomUUID(),assetId=`asset-${i}`;
    const controls={...templateType.operateControls,version:1,
      responseCalendar:item.calendar,timezone:"America/New_York",
      defaultResponseHours:4,businessStartHour:9,businessEndHour:17};
    if("holidays" in item) controls.holidayDates=item.holidays;
    else delete controls.holidayDates;
    if(item.calendar===undefined) delete controls.responseCalendar;
    const manifest=structuredClone(templateManifest);
    manifest.d5oPresentation.phaseContract.workTypes.find((row)=>
      row.workTypeKey==="lifecycle-service").operateControls=controls;
    const state={activation:{status:"Active"},assets:[{id:assetId,name:`Asset ${i}`,status:"Supported"}],
      agreements:[],requests:[{id:requestId,assetId,title:`Calendar request ${i}`,
        description:"Synthetic service calendar qualification",impact:"Standard",
        contact:"Fictional customer",reportedAt:item.at,owner:"operations_leader",
        status:"New",coverage:"Awaiting",jobIds:[],currentCycleJobIds:[],history:[]}],
      jobs:[],events:[],authorityRevision:1};
    records.push({id:presentation,canonicalWorkId:workId,workspace:workspaceKey,
      phaseConfigurationVersionId:versionId,customer:"Fictional customer",site:"Test site",
      title:`Calendar work ${i}`,type:"Lifecycle Service"});
    seeds.push(
      `insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from) values (${q(versionId)},${q(tenantId)},${i+1},'draft',${q("a".repeat(64))},${q(JSON.stringify(manifest))}::jsonb,now()-interval '1 day');`,
      `insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status) values (${q(versionId)},'lifecycle-service','Lifecycle Service','active');`,
      `update d5o_hosted.configuration_versions set status='published' where id=${q(versionId)};`,
      `insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,configuration_digest,work_type_key,title,created_by) values (${q(workId)},${q(workspaceId)},${q(tenantId)},${q(versionId)},${q("a".repeat(64))},'lifecycle-service',${q(`Calendar work ${i}`)},${q(actorId)});`,
      `insert into d5o_hosted.connected_operate_states(workspace_id,work_id,decision_revision,state) values (${q(workspaceId)},${q(workId)},1,${q(JSON.stringify(state))}::jsonb);`,
      `insert into d5o_hosted.connected_deploy_states(workspace_id,work_id,decision_revision,state) values (${q(workspaceId)},${q(workId)},1,'{"authorityRevision":1,"events":[],"permits":[],"reports":[]}'::jsonb);`
    );
    Object.assign(item,{workId,presentation,requestId,versionId});
  }
  seeds.push("commit;");sql(seeds.join("\n"));
  const membershipId=sql(`select id from d5o_hosted.memberships where workspace_id=${q(workspaceId)} and actor_user_id=${q(actorId)};`);
  const saved=await admin.rpc("d5o_hosted_command_save_v1",{p_workspace_key:workspaceKey,
    p_state_key:"work",p_expected_revision:0,p_state:{workspace:workspaceKey,schemaVersion:1,records},
    p_actor_user_id:actorId,p_membership_id:membershipId});
  assert(!saved.error,`calendar_raw_fixture:${saved.error?.message}`);
  sql(cases.map((item)=>`insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id) values (${q(workspaceId)},${q(item.workId)},${q(item.presentation)});`).join("\n"));
  sql(`create schema d5o_qualification;revoke all on schema d5o_qualification from public,anon,authenticated;
    create table d5o_qualification.clock(fixed_at timestamptz not null);
    revoke all on d5o_qualification.clock from public,anon,authenticated;
    insert into d5o_qualification.clock values ('2026-10-26T14:00:00Z');
    create function d5o_qualification.fixed_now() returns timestamptz language sql stable security definer set search_path=''
      as 'select fixed_at from d5o_qualification.clock limit 1';
    revoke all on function d5o_qualification.fixed_now() from public,anon,authenticated;
    do $clock$ declare v_source text;v_replaced text;begin
      v_source:=pg_get_functiondef('public.d5o_hosted_operate_command_internal_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure);
      v_replaced:=regexp_replace(v_source,'v_now[[:space:]]+timestamptz[[:space:]]*:=[[:space:]]*now\\(\\)',
        'v_now timestamptz:=d5o_qualification.fixed_now()','i');
      if v_replaced=v_source then raise exception 'operate_clock_seam_missing';end if;
      execute v_replaced;
    end $clock$;`);
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email,password});assert(!login.error);
  for(const item of cases) {
    sql(`update d5o_qualification.clock set fixed_at=${q(item.at)}::timestamptz;`);
    const result=await client.rpc("d5o_hosted_operate_command_v1",{
      p_workspace_key:workspaceKey,p_presentation_id:item.presentation,p_action:"triage-request",
      p_input:{requestId:item.requestId,serviceCategory:"Synthetic service"},
      p_command_id:`calendar-${item.requestId}`,p_expected_source_revision:1,
      p_expected_deploy_revision:1,p_expected_operate_revision:1});
    const actual=JSON.parse(sql(`select jsonb_build_object('revision',decision_revision,'request',
      (select r from jsonb_array_elements(state->'requests') r where r->>'id'=${q(item.requestId)}))::text
      from d5o_hosted.connected_operate_states where workspace_id=${q(workspaceId)} and work_id=${q(item.workId)};`));
    try {
      if(item.error) {
        assert.equal(result.error?.message,item.error);
        assert.equal(actual.revision,1);
        assert.equal(actual.request.status,"New");
      } else {
        assert(!result.error,`${item.name}:${result.error?.message}`);
        assert.equal(actual.revision,2);
        assert.equal(actual.request.status,"Triaged");
        assert.equal(new Date(actual.request.responseDueAt).toISOString(),
          new Date(item.due).toISOString());
        assert.equal(actual.request.slaBasis.configurationVersionId,item.versionId);
      }
      evidence.tests.push({name:item.name,status:"PASS",at:item.at,
        outcome:item.error??actual.request.responseDueAt,sqlstate:result.error?.code??null,
        workId:item.workId,configurationVersionId:item.versionId});
    } catch(error) {
      evidence.tests.push({name:item.name,status:"FAIL",detail:String(error.message),
        error:result.error?.message??null,state:actual.request.status});
    }
  }
  const clockAcl=sql(`select has_schema_privilege('authenticated','d5o_qualification','USAGE')::text || ':' ||
    has_table_privilege('authenticated','d5o_qualification.clock','UPDATE')::text;`);
  assert.equal(clockAcl,"false:false");
  evidence.clock={browserControllable:false,authenticatedSchemaUsage:false,authenticatedUpdate:false};
} catch(error) {evidence.setupError=String(error.stack??error).slice(0,1800);process.exitCode=1;}
finally {
  if(runtime) {
    try {evidence.cleanup=await cleanupP0aRuntime(runtime);}
    catch(error) {evidence.cleanup={error:String(error.message)};process.exitCode=1;}
  }
  evidence.summary={passed:evidence.tests.filter((item)=>item.status==="PASS").length,
    failed:evidence.tests.filter((item)=>item.status==="FAIL").length,
    setupError:!!evidence.setupError,cleanupVerified:!!evidence.cleanup?.clean};
  if(evidence.summary.failed||!evidence.summary.cleanupVerified) process.exitCode=1;
  mkdirSync(resolve(root,".tmp"),{recursive:true});
  writeFileSync(output,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({...evidence.summary,output}));
}
