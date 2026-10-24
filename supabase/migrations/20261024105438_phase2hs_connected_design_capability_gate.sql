-- Keep customer feature availability at the authoritative mutation boundary.
-- Existing pilot workspaces have no tenant_provisioning row and retain their
-- established guards. Provisioning writes before activation are unaffected.
create function d5o_hosted.require_connected_work_capability_on_mutation_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists (
    select 1 from d5o_hosted.tenant_provisioning p
    where p.workspace_id=new.workspace_id and p.lifecycle='active'
  ) and not d5o_hosted.capability_available_v1(new.workspace_id,'connected_work') then
    raise exception 'connected_work_unavailable' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function d5o_hosted.require_connected_work_capability_on_mutation_v1()
  from public,anon,authenticated,service_role;

-- The generic Work writer and prototype state also serve older supported
-- workflows. Connected Work creation already checks the capability in
-- d5o_hosted_create_connected_work_v1; gate the connected decisions below
-- without restricting the independent generic Work command.
create trigger phase2hs_design_handoff_capability_guard before insert or update
  on d5o_hosted.connected_design_handoffs for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
create trigger phase2hs_design_state_capability_guard before insert or update
  on d5o_hosted.connected_design_states for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
create trigger phase2hs_design_evidence_capability_guard before insert or update
  on d5o_hosted.design_document_evidence for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
