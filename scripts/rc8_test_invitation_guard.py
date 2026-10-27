"""Rollback-only pilot/new-tenant and privilege tests on offline upgraded DB."""
import json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
target=json.loads(subprocess.run(['docker','inspect','d5o-rc7-historical-db'],capture_output=True,text=True,check=True).stdout)[0]
assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
psql=['docker','exec','-i','d5o-rc7-historical-db','psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At']
sql="""
begin;
-- Existing pilot proposal remains eligible for a no-op update.
update d5o_hosted.admin_identity_requests i set requested_role=i.requested_role
 where i.action='invite' and i.requested_role='field_worker'
   and i.status='setup_completed';
select 'PILOT_ALLOWED';
insert into d5o_hosted.configuration_templates(template_key,name)
 values('rc8-synthetic','RC8 Synthetic Template');
insert into d5o_hosted.configuration_template_versions
 (template_id,version_number,status,manifest_json,work_types_json,
  create_roles_json,routes_json,source_sha256)
 select id,1,'draft','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,
        '{}'::jsonb,repeat('0',64)
 from d5o_hosted.configuration_templates where template_key='rc8-synthetic';
insert into d5o_hosted.tenant_provisioning
 (workspace_id,request_id,request_fingerprint,template_version_id,
  configuration_version_id,country,initial_admin_email,initial_invitation_id,
  lifecycle,created_by)
 select i.workspace_id,'rc8-synthetic-deny','synthetic',v.id,c.id,
  'US','rc8@example.invalid','rc8-synthetic-admin','awaiting_admin',i.provider_user_id
 from d5o_hosted.admin_identity_requests i
 cross join lateral (select id from d5o_hosted.configuration_template_versions
   where template_id=(select id from d5o_hosted.configuration_templates
      where template_key='rc8-synthetic') limit 1) v
 cross join lateral (select id from d5o_hosted.configuration_versions limit 1) c
 where i.action='invite' and i.requested_role='field_worker'
   and i.status='setup_completed';
do $rc8$
begin
  begin
    update d5o_hosted.admin_identity_requests i set requested_role=i.requested_role
      where i.action='invite' and i.requested_role='field_worker'
        and i.status='setup_completed';
    raise exception 'rc8_guard_failed_to_reject';
  exception when sqlstate '42501' then
    raise notice 'RC8_NEW_TENANT_REJECTED_42501';
  end;
end $rc8$;
rollback;
"""
run=subprocess.run(psql,input=sql,capture_output=True,text=True,encoding='utf-8')
if run.returncode: raise RuntimeError('synthetic guard test failed: '+next((x for x in run.stderr.splitlines() if 'ERROR:' in x),'unknown'))
if 'PILOT_ALLOWED' not in run.stdout or 'RC8_NEW_TENANT_REJECTED_42501' not in run.stderr:
    raise RuntimeError('synthetic guard expected markers absent')
access_sql="""select has_table_privilege('anon','d5o_hosted.rc8_invitation_bridge_receipts','SELECT'),
  has_table_privilege('authenticated','d5o_hosted.rc8_invitation_bridge_receipts','SELECT'),
  has_table_privilege('service_role','d5o_hosted.rc8_invitation_bridge_receipts','SELECT'),
  has_function_privilege('anon','d5o_hosted.rc8_pilot_field_worker_invitation_guard()','EXECUTE'),
  (select relrowsecurity from pg_class where oid='d5o_hosted.rc8_invitation_bridge_receipts'::regclass),
  (select convalidated from pg_constraint where conrelid='d5o_hosted.admin_identity_requests'::regclass
    and conname='admin_identity_requests_role_check')"""
access=subprocess.run(psql+['-c',access_sql],capture_output=True,text=True,check=True)
if access.stdout.strip()!='f|f|f|f|t|t': raise RuntimeError('bridge permission or constraint invariant failed')
ending=subprocess.run(psql+['-c',"select count(*) from d5o_hosted.tenant_provisioning"],capture_output=True,text=True,check=True)
if ending.stdout.strip()!='0': raise RuntimeError('synthetic provisioning row persisted')
result={'format':'d5o-rc8-invitation-guard-tests-v1','pilot_noop_update':'PASS',
 'synthetic_provisioned_tenant_field_worker_rejected_sqlstate':'42501',
 'synthetic_data_rolled_back':True,'bridge_receipt_read_grants_anon_authenticated_service_role':False,
 'guard_function_public_execute':False,'receipt_rls_enabled':True,'role_constraint_validated':True}
(ROOT/'docs/release/evidence/D5O_RC8_INVITATION_GUARD_TESTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
