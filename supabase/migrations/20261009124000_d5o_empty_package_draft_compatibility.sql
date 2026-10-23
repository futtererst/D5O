-- A newly created connected Work has no raw packages key. Its read projection
-- renders an empty package array, which an ordinary Discover draft carries
-- back on save. Empty/missing are equivalent only while no package exists.
create or replace function d5o_hosted.guard_connected_identity_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_link record;v_record jsonb;v_prior jsonb;v_count integer;
begin
  if new.state_key not in ('work','catalog') or not exists (
    select 1 from d5o_hosted.work_identity_links l
      where l.workspace_id=new.workspace_id) then return new; end if;
  if pg_catalog.jsonb_typeof(new.state_json->'records') is distinct from 'array' then
    raise exception 'connected_records_missing' using errcode='42501'; end if;
  for v_link in select work_id,presentation_id from d5o_hosted.work_identity_links
      where workspace_id=new.workspace_id loop
    select count(*),(pg_catalog.jsonb_agg(item)->0) into v_count,v_record
      from pg_catalog.jsonb_array_elements(new.state_json->'records') item
      where item->>'id'=v_link.presentation_id;
    if v_count<>1 or v_record->>'canonicalWorkId' is distinct from v_link.work_id::text
      or v_record->>'workspace' is distinct from (
        select workspace_key from d5o_hosted.workspaces where id=new.workspace_id) then
      raise exception 'connected_identity_changed' using errcode='42501'; end if;
    if tg_op='UPDATE' then
      select item into v_prior from pg_catalog.jsonb_array_elements(
        old.state_json->'records') item where item->>'id'=v_link.presentation_id;
      if coalesce(v_prior->'packages','[]'::jsonb) is distinct from
        coalesce(v_record->'packages','[]'::jsonb) then
        raise exception 'typed_package_command_required' using errcode='42501'; end if;
      if new.state_key='work' and exists(
        select 1 from d5o_hosted.connected_offer_states o
          where o.workspace_id=new.workspace_id and o.work_id=v_link.work_id)
        and v_prior#>'{discovery,proposal}' is distinct from
          v_record#>'{discovery,proposal}' then
        raise exception 'typed_offer_command_required' using errcode='42501'; end if;
    end if;
  end loop;
  if tg_op='UPDATE' and new.state_key='catalog' and
    (select coalesce(pg_catalog.jsonb_agg(item order by ordinal),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(coalesce(new.state_json->'packages','[]'::jsonb))
        with ordinality as entries(item,ordinal)
      where item->>'workId' in (select presentation_id from
        d5o_hosted.work_identity_links where workspace_id=new.workspace_id))
    is distinct from
    (select coalesce(pg_catalog.jsonb_agg(item order by ordinal),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(coalesce(old.state_json->'packages','[]'::jsonb))
        with ordinality as entries(item,ordinal)
      where item->>'workId' in (select presentation_id from
        d5o_hosted.work_identity_links where workspace_id=new.workspace_id)) then
    raise exception 'typed_package_command_required' using errcode='42501'; end if;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_connected_identity_v1()
  from public,anon,authenticated,service_role;
