"""Rollback-only synthetic actor, cross-tenant and revoked-member RPC checks."""
import json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
target=json.loads(subprocess.run(['docker','inspect','d5o-rc7-historical-db'],capture_output=True,text=True,check=True).stdout)[0]
assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
psql=['docker','exec','-i','d5o-rc7-historical-db','psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At']
q=subprocess.run(psql+['-c',"select workspace_key from d5o_hosted.workspaces where status='active' order by workspace_key"],capture_output=True,text=True,check=True)
keys=q.stdout.strip().splitlines()
if len(keys)<2 or any("'" in x for x in keys): raise RuntimeError('two safe local workspace keys required')
own,other=keys[:2]
sql=f"""
begin;
create temporary table rc8_actor(id uuid primary key) on commit drop;
insert into rc8_actor values(gen_random_uuid());
insert into auth.users(id,email,aud,role,created_at,updated_at)
  select id,'rc8-synthetic@example.invalid','authenticated','authenticated',now(),now()
  from rc8_actor;
insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
  select w.id,a.id,'read_only_auditor','active' from d5o_hosted.workspaces w
  cross join rc8_actor a where w.workspace_key='{own}';
select set_config('request.jwt.claim.sub',(select id::text from rc8_actor),true);
set local role authenticated;
do $rc8$
begin
  perform public.d5o_hosted_list_work_v1('{own}',10);
  raise notice 'RC8_OWN_WORK_ALLOWED';
  begin
    perform public.d5o_hosted_list_work_v1('{other}',10);
    raise exception 'rc8_cross_tenant_allowed';
  exception when sqlstate '42501' then
    raise notice 'RC8_CROSS_TENANT_DENIED_42501';
  end;
end $rc8$;
reset role;
update d5o_hosted.memberships set status='suspended'
  where actor_user_id=(select id from rc8_actor);
set local role authenticated;
do $rc8$
begin
  begin
    perform public.d5o_hosted_list_work_v1('{own}',10);
    raise exception 'rc8_revoked_member_allowed';
  exception when sqlstate '42501' then
    raise notice 'RC8_REVOKED_MEMBER_DENIED_42501';
  end;
end $rc8$;
rollback;
"""
run=subprocess.run(psql,input=sql,capture_output=True,text=True,encoding='utf-8')
if run.returncode: raise RuntimeError('synthetic tenant test failed: '+next((x for x in run.stderr.splitlines() if 'ERROR:' in x),'unknown'))
required=['RC8_OWN_WORK_ALLOWED','RC8_CROSS_TENANT_DENIED_42501','RC8_REVOKED_MEMBER_DENIED_42501']
if any(x not in run.stderr for x in required): raise RuntimeError('synthetic tenant expected marker absent')
out={'format':'d5o-rc8-tenant-isolation-v1','synthetic_actor_own_workspace':'PASS',
 'cross_tenant_rpc_denied_sqlstate':'42501','suspended_membership_rpc_denied_sqlstate':'42501',
 'transaction_rolled_back':True,'auth_credentials_used':False}
(ROOT/'docs/release/evidence/D5O_RC8_TENANT_ISOLATION.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
