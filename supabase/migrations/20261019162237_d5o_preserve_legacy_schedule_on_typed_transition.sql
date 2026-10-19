-- Preserve the retained prototype schedule when the first typed scheduling write begins.
-- The hosted read advertises the prototype revision until a connected row exists.
-- Without this transition, the writer initializes revision 1 and rejects every
-- legitimate draft against an existing revision 2+ as stale_schedule.
do $$
begin
  if exists (
    select 1 from d5o_hosted.prototype_states p
    where p.state_key='schedule'
      and not exists (
        select 1 from d5o_hosted.connected_schedule_states s
        where s.workspace_id=p.workspace_id
      )
      and (
        pg_catalog.jsonb_typeof(p.state_json)<>'object'
        or coalesce(p.state_json->>'anchorDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or pg_catalog.jsonb_typeof(p.state_json->'assignments')<>'array'
        or pg_catalog.jsonb_typeof(p.state_json->'publications')<>'array'
        or pg_catalog.jsonb_typeof(p.state_json->'receipts')<>'array'
      )
  ) then
    raise exception 'legacy_schedule_transition_requires_review';
  end if;
end $$;

insert into d5o_hosted.connected_schedule_states
  (workspace_id,decision_revision,state)
select p.workspace_id,greatest(p.revision,1),p.state_json
from d5o_hosted.prototype_states p
where p.state_key='schedule'
  and not exists (
    select 1 from d5o_hosted.connected_schedule_states s
    where s.workspace_id=p.workspace_id
  )
on conflict (workspace_id) do nothing;