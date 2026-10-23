-- The authenticated draft writer's return value is itself a Work read. Keep
-- its result under the same per-actor document scope as the ordinary read.
alter function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  rename to d5o_hosted_prototype_save_internal_v1;
revoke all on function public.d5o_hosted_prototype_save_internal_v1(
  text,text,bigint,jsonb) from public,anon,authenticated,service_role;

create function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text,p_state_key text,p_expected_revision bigint,p_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or auth.uid() is null then
    raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  v_result:=public.d5o_hosted_prototype_save_internal_v1(
    p_workspace_key,p_state_key,p_expected_revision,p_state);
  if p_state_key='work' then
    return d5o_hosted.redact_support_document_read_v1(
      p_workspace_key,auth.uid(),v_result); end if;
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(
  text,text,bigint,jsonb) from public,anon,service_role;
grant execute on function public.d5o_hosted_prototype_save_v1(
  text,text,bigint,jsonb) to authenticated;
