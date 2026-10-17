-- Surface a sourced additional-cost forecast to the eligible Finance role.
create or replace function public.d5o_hosted_design_cost_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 result jsonb:='[]'::jsonb; work_item record; task_item record; rev integer; current_digest text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 if member.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if member.role not in ('project_manager','billing_commercial_lead') then return result; end if;
 for work_item in select w.id,l.presentation_id,w.created_by from d5o_hosted.work_records w
  join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
  where w.workspace_id=ws and (member.role='billing_commercial_lead' or w.created_by=actor)
   and (exists(select 1 from d5o_hosted.design_spend_commitments c where c.workspace_id=ws and c.work_id=w.id and c.status='Approved')
     or exists(select 1 from d5o_hosted.outlook_assessments a where a.workspace_id=ws and a.work_id=w.id)) loop
  select coalesce(p.revision,0) into rev from d5o_hosted.design_cost_positions p where p.workspace_id=ws and p.work_id=work_item.id;
  rev:=coalesce(rev,0);
  current_digest:=d5o_hosted.outlook_source_v1(ws,work_item.id)->>'digest';
  if member.role='project_manager' then
   if exists(select 1 from d5o_hosted.design_spend_commitments c where c.workspace_id=ws and c.work_id=work_item.id and c.status='Approved'
    and not exists(select 1 from d5o_hosted.design_cost_links x where x.commitment_id=c.id)) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Link Design cost source','workId',work_item.presentation_id,
      'revision',rev,'status','Unlinked approved commitment','title','Link approved Design commitment to Finance',
      'phase','Operate','focus','finance','taskKind','design-cost','position','preparation','ownership','Assigned project manager',
      'blocker','Choose the exact approved Design commitment and retain its source.'));
   elsif exists(select 1 from d5o_hosted.design_cost_links x where x.workspace_id=ws and x.work_id=work_item.id) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Record Design cost','workId',work_item.presentation_id,
      'revision',rev,'status','Source-backed actual needed','title','Submit actual Design cost or correction',
      'phase','Operate','focus','finance','taskKind','design-cost','position','preparation','ownership','Assigned project manager',
      'blocker','Approval of the commitment does not establish incurred cost.'));
   end if;
   if not exists(select 1 from d5o_hosted.outlook_assessments a where a.workspace_id=ws and a.work_id=work_item.id
      and a.source_digest=current_digest and a.status in ('Prepared','Complete','Reviewed with gaps')) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Prepare Work cost outlook','workId',work_item.presentation_id,
      'revision',rev,'status','Missing or stale assessment','title','Prepare cost-outlook completeness assessment',
      'phase','Operate','focus','finance','taskKind','outlook-assessment','position','preparation','ownership','Assigned project manager',
      'blocker','Identify unresolved categories and forecast sources before independent Finance review.'));
   end if;
  else
   if not exists(select 1 from d5o_hosted.connected_job_finance_states f
    where f.workspace_id=ws and f.work_id=work_item.id and f.remaining_forecast_minor is not null) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Record Work cost forecast','workId',work_item.presentation_id,
      'revision',rev,'status','Additional cost unknown','title','Record sourced additional Work cost forecast',
      'phase','Operate','focus','finance','taskKind','outlook-assessment','position','action','ownership','Finance reviewer',
      'blocker','Estimate only costs beyond commitments; do not turn an absent cost into zero.'));
   end if;
   for task_item in select c.id,c.work_id,l.presentation_id,c.source_reference from d5o_hosted.design_cost_claims c
    join d5o_hosted.work_identity_links l on l.work_id=c.work_id and l.workspace_id=c.workspace_id
    where c.workspace_id=ws and c.work_id=work_item.id and c.status='Prepared' and c.prepared_by<>actor loop
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Design cost','workId',task_item.presentation_id,
      'revision',rev,'decisionId',task_item.id,'status','Prepared','title','Review sourced Design cost',
      'phase','Operate','focus','finance','taskKind','design-cost','position','action','ownership','Finance reviewer',
      'blocker',null));
   end loop;
   for task_item in select a.id,a.work_id,l.presentation_id from d5o_hosted.outlook_assessments a
    join d5o_hosted.work_identity_links l on l.work_id=a.work_id and l.workspace_id=a.workspace_id
    where a.workspace_id=ws and a.work_id=work_item.id and a.status='Prepared'
     and a.prepared_by<>actor and a.source_digest=current_digest loop
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Work cost outlook','workId',task_item.presentation_id,
      'revision',rev,'decisionId',task_item.id,'status','Prepared','title','Review cost-outlook completeness',
      'phase','Operate','focus','finance','taskKind','outlook-assessment','position','action','ownership','Finance reviewer',
      'blocker',null));
   end loop;
  end if;
 end loop;
 return result;
end; $$;
