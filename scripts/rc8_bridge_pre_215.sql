-- RC8 operational precondition for frozen source order 215.
-- Execute only in the SAME transaction as source 215 and rc8_bridge_post_215.sql.
-- No change is externally visible unless the whole transaction commits.
do $rc8$
begin
  if to_regclass('d5o_hosted.tenant_provisioning') is not null then
    raise exception 'rc8_precondition_tenant_provisioning_exists';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations
             where version='20261023140000') then
    raise exception 'rc8_precondition_215_already_recorded';
  end if;
  if (select count(*) from d5o_hosted.admin_identity_requests
      where action='invite' and requested_role='field_worker'
        and status='setup_completed') <> 1 then
    raise exception 'rc8_precondition_legacy_invitation_count';
  end if;
  if exists (select 1 from d5o_hosted.admin_identity_requests i
      where i.action='invite' and i.requested_role='field_worker'
        and i.status='setup_completed'
        and (i.setup_completed_at is null or i.provider_user_id is null
          or i.created_at >= timestamptz '2026-10-23 14:00:00+00'
          or not exists (select 1 from auth.users u where u.id=i.provider_user_id)
          or not exists (select 1 from d5o_hosted.memberships m
              where m.workspace_id=i.workspace_id
                and m.actor_user_id=i.provider_user_id
                and m.role='field_worker' and m.status='active'))) then
    raise exception 'rc8_precondition_legacy_invitation_link';
  end if;
  if exists (select 1 from pg_trigger t
      where t.tgrelid='d5o_hosted.admin_identity_requests'::regclass
        and not t.tgisinternal and t.tgenabled<>'D') then
    raise exception 'rc8_precondition_invitation_trigger_present';
  end if;
end $rc8$;

create temporary table rc8_legacy_invitation on commit drop as
  select workspace_id,command_id,requested_role,status,created_at,
         setup_completed_at,provider_user_id,fingerprint
    from d5o_hosted.admin_identity_requests
    where action='invite' and requested_role='field_worker'
      and status='setup_completed';

-- The frozen migration installs its new check while this one historical
-- proposal has a CHECK-permitted neutral value. The original is restored
-- before commit, after installing the reviewed compatibility guard.
update d5o_hosted.admin_identity_requests i set requested_role=null
  from rc8_legacy_invitation l
  where i.workspace_id=l.workspace_id and i.command_id=l.command_id
    and i.requested_role=l.requested_role;

do $rc8$
begin
  if (select count(*) from d5o_hosted.admin_identity_requests i
      join rc8_legacy_invitation l using(workspace_id,command_id)
      where i.requested_role is null and i.status=l.status
        and i.fingerprint=l.fingerprint) <> 1 then
    raise exception 'rc8_preparation_update_failed';
  end if;
end $rc8$;
