-- Project the narrower current spending window without rewriting the approved Design cap.
create or replace function public.d5o_hosted_design_spend_read_v1(p_workspace_key text,p_presentation_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid(); ws uuid; w uuid; rev integer; src jsonb; cap bigint; window_cap bigint; used bigint;
begin
 if current_setting('role',true)<>'authenticated' or a is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not exists(select 1 from d5o_hosted.memberships where workspace_id=ws and actor_user_id=a and status='active'
  and role in ('admin','project_manager','operations_leader','billing_commercial_lead')) then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 select revision into rev from d5o_hosted.design_spend_positions where workspace_id=ws and work_id=w;
 src:=d5o_hosted.design_spend_source_v1(ws,w);
 select coalesce(sum(amount_minor),0) into used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 cap:=case when src is not null then (src#>>'{authorization,spendCapMinor}')::bigint else null end;
 select cap_minor into window_cap from d5o_hosted.design_spend_authorities
  where workspace_id=ws and work_id=w and status='Approved' and source_digest=src->>'digest'
    and current_date between valid_from and valid_until order by created_at desc limit 1;
 return pg_catalog.jsonb_build_object('revision',coalesce(rev,0),'source',src,'committedMinor',used,
  'remainingMinor',case when cap is null then null else least(cap,coalesce(window_cap,cap))-used end,
  'designCapMinor',cap,'windowCapMinor',window_cap,
  'authorities',coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.created_at) from d5o_hosted.design_spend_authorities x
    where x.workspace_id=ws and x.work_id=w),'[]'::jsonb),
  'commitments',coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.created_at) from d5o_hosted.design_spend_commitments x
    where x.workspace_id=ws and x.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_design_spend_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_spend_read_v1(text,text) to authenticated;


