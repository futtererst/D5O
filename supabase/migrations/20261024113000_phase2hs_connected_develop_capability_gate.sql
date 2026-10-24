-- Extend the same connected_work mutation gate to the protected Develop
-- command tables. A direct authenticated RPC must not bypass a disabled
-- tenant rollout while an existing session remains valid.
create trigger phase2hs_schedule_capability_guard before insert or update
  on d5o_hosted.connected_schedule_states for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
create trigger phase2hs_deploy_capability_guard before insert or update
  on d5o_hosted.connected_deploy_states for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
create trigger phase2hs_workforce_capability_guard before insert or update
  on d5o_hosted.connected_crew_profiles for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
create trigger phase2hs_purchase_position_capability_guard before insert or update
  on d5o_hosted.purchase_authority_positions for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
create trigger phase2hs_labor_position_capability_guard before insert or update
  on d5o_hosted.labor_authority_positions for each row
  execute function d5o_hosted.require_connected_work_capability_on_mutation_v1();
