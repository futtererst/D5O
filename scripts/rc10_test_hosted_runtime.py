"""Rollback-only hosted configuration, route RPC and public RLS probes."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = json.loads(subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"],
                                   capture_output=True, text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none" and not target["HostConfig"].get("PortBindings")
psql = ["docker", "exec", "-i", "d5o-rc7-historical-db", "psql", "-U", "supabase_admin",
        "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At"]
sql = """
begin;
create temporary table rc10_actor(id uuid primary key) on commit drop;
insert into rc10_actor values(gen_random_uuid());
insert into auth.users(id,email,aud,role,created_at,updated_at)
  select id,'rc10-synthetic@example.invalid','authenticated','authenticated',now(),now() from rc10_actor;
insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
  select w.id,a.id,'read_only_auditor','active' from d5o_hosted.workspaces w cross join rc10_actor a
  where w.workspace_key='rybex';
select set_config('request.jwt.claim.sub',(select id::text from rc10_actor),true);
set local role authenticated;
do $rc10$
declare v jsonb;
begin
  v:=public.d5o_hosted_workspaces_v1();
  if jsonb_array_length(v)<>1 or v->0->>'workspaceKey'<>'rybex' then
    raise exception 'hosted_workspace_scope_failed'; end if;
  raise notice 'RC10_OWN_WORKSPACE_PASS';
  v:=public.d5o_hosted_configuration_inventory_v1('rybex');
  if v->>'status'<>'ready' or v->>'activeVersionId' is null then
    raise exception 'hosted_configuration_unavailable'; end if;
  raise notice 'RC10_HOSTED_CONFIGURATION_READY';
  begin perform public.d5o_hosted_configuration_inventory_v1('rotork');
    raise exception 'cross_tenant_configuration_allowed';
  exception when sqlstate '42501' then raise notice 'RC10_CROSS_TENANT_CONFIG_DENIED_42501'; end;
  begin perform public.d5o_hosted_private_evidence_index_v1('rybex',0,10);
    raise exception 'private_evidence_index_allowed';
  exception when sqlstate '42501' then raise notice 'RC10_PRIVATE_INDEX_DENIED_42501'; end;
end $rc10$;
select case when (select count(*) from public.workspaces)=0 and
  (select count(*) from public.audit_events)=0 then 'RC10_LEGACY_PUBLIC_RLS_DENY' else 'FAIL' end;
reset role;
update d5o_hosted.memberships set status='suspended' where actor_user_id=(select id from rc10_actor);
set local role authenticated;
do $rc10$
begin
  begin perform public.d5o_hosted_configuration_inventory_v1('rybex');
    raise exception 'suspended_configuration_allowed';
  exception when sqlstate '42501' then raise notice 'RC10_SUSPENDED_CONFIG_DENIED_42501'; end;
end $rc10$;
rollback;
"""
run = subprocess.run(psql, input=sql, capture_output=True, text=True, encoding="utf-8")
if run.returncode:
    raise RuntimeError("hosted runtime probe failed: " + next(
        (line for line in run.stderr.splitlines() if "ERROR:" in line), "unknown"))
required = ["RC10_OWN_WORKSPACE_PASS", "RC10_HOSTED_CONFIGURATION_READY",
            "RC10_CROSS_TENANT_CONFIG_DENIED_42501", "RC10_PRIVATE_INDEX_DENIED_42501",
            "RC10_SUSPENDED_CONFIG_DENIED_42501"]
if any(marker not in run.stderr for marker in required) or "RC10_LEGACY_PUBLIC_RLS_DENY" not in run.stdout:
    raise RuntimeError("hosted runtime expected marker missing")
out = {"format": "d5o-rc10-hosted-runtime-probes-v1", "network_mode": "none",
       "synthetic_actor_own_workspace": "PASS", "published_configuration": "ready",
       "cross_tenant_configuration_denied_sqlstate": "42501",
       "private_index_authenticated_denied_sqlstate": "42501",
       "suspended_member_configuration_denied_sqlstate": "42501",
       "legacy_public_table_rls_denied": True,
       "synthetic_transaction_rolled_back": True, "real_user_credentials_used": False}
(root / "docs/release/evidence/D5O_RC10_HOSTED_RUNTIME_PROBES.json").write_text(
    json.dumps(out, indent=2) + "\n")
print(json.dumps(out))
