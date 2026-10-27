-- RC8 operational postcondition for frozen source order 215.
-- Execute in the same transaction as rc8_bridge_pre_215.sql and source 215.
-- Existing pilot workspaces have no tenant_provisioning row. A field-worker
-- invitation remains a proposal; membership still requires governed binding.
alter table d5o_hosted.admin_identity_requests
  drop constraint admin_identity_requests_role_check;
alter table d5o_hosted.admin_identity_requests
  add constraint admin_identity_requests_role_check
  check ((action='invite' and (requested_role is null or requested_role in
    ('executive','operations_leader','business_development_lead','project_manager',
     'billing_commercial_lead','field_supervisor','closeout_lead','read_only_auditor')
     or (requested_role='admin' and provisioning_workspace_id=workspace_id)
     or (requested_role='field_worker' and provisioning_workspace_id is null)))
    or (action='recovery' and requested_role is null));

create function d5o_hosted.rc8_pilot_field_worker_invitation_guard()
returns trigger language plpgsql security definer set search_path='' as $rc8$
begin
  if new.action='invite' and new.requested_role='field_worker'
    and exists (select 1 from d5o_hosted.tenant_provisioning p
      where p.workspace_id=new.workspace_id) then
    raise exception 'field_worker_invitation_requires_pilot_workspace'
      using errcode='42501';
  end if;
  return new;
end $rc8$;
revoke all on function d5o_hosted.rc8_pilot_field_worker_invitation_guard()
  from public,anon,authenticated,service_role;
create trigger rc8_pilot_field_worker_invitation_guard
  before insert or update on d5o_hosted.admin_identity_requests
  for each row execute function d5o_hosted.rc8_pilot_field_worker_invitation_guard();

update d5o_hosted.admin_identity_requests i
  set requested_role=l.requested_role
  from rc8_legacy_invitation l
  where i.workspace_id=l.workspace_id and i.command_id=l.command_id
    and i.requested_role is null;

create table d5o_hosted.rc8_invitation_bridge_receipts (
  bridge_key text primary key check(bridge_key='rc8_215_field_worker_compatibility'),
  source_version text not null check(source_version='20261023140000'),
  workspace_id uuid not null,
  invitation_command_id text not null,
  original_role text not null check(original_role='field_worker'),
  original_status text not null check(original_status='setup_completed'),
  original_fingerprint text not null,
  completed_at timestamptz not null default now(),
  foreign key(workspace_id,invitation_command_id)
    references d5o_hosted.admin_identity_requests(workspace_id,command_id)
);
alter table d5o_hosted.rc8_invitation_bridge_receipts enable row level security;
revoke all on d5o_hosted.rc8_invitation_bridge_receipts
  from public,anon,authenticated,service_role;
insert into d5o_hosted.rc8_invitation_bridge_receipts
  (bridge_key,source_version,workspace_id,invitation_command_id,
   original_role,original_status,original_fingerprint)
select 'rc8_215_field_worker_compatibility','20261023140000',
  workspace_id,command_id,requested_role,status,fingerprint
from rc8_legacy_invitation;

do $rc8$
begin
  if (select count(*) from d5o_hosted.rc8_invitation_bridge_receipts)<>1
    or (select count(*) from d5o_hosted.admin_identity_requests i
        join rc8_legacy_invitation l using(workspace_id,command_id)
        where i.requested_role=l.requested_role and i.status=l.status
          and i.created_at=l.created_at
          and i.setup_completed_at=l.setup_completed_at
          and i.provider_user_id=l.provider_user_id
          and i.fingerprint=l.fingerprint)<>1 then
    raise exception 'rc8_postcondition_invitation_not_preserved';
  end if;
end $rc8$;
