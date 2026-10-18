-- Rolled-back, database-only selected-reviewer probe. This is not a business approval.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000001101','fictional-sub-admin-a@example.test'),
 ('00000000-0000-4000-8000-000000001102','fictional-sub-admin-b@example.test'),
 ('00000000-0000-4000-8000-000000001103','fictional-sub-pm@example.test');
insert into d5o_hosted.workspaces(id,workspace_key,display_name)
 values('00000000-0000-4000-8000-000000001201','rybex','Fictional Rybex');
insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values
 ('00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000001101','admin'),
 ('00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000001102','admin'),
 ('00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000001103','project_manager');
insert into d5o_hosted.configuration_tenants(id,workspace_id,status)
 values('00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000001201','active');
insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,effective_from,manifest_json)
 values('00000000-0000-4000-8000-000000001302','00000000-0000-4000-8000-000000001301',1,'draft',repeat('a',64),now(),
  '{"workTypes":[{"key":"technical-delivery"}]}');
insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
 values('00000000-0000-4000-8000-000000001302','technical-delivery','Technical delivery','active');
update d5o_hosted.configuration_versions set status='published'
 where id='00000000-0000-4000-8000-000000001302';
insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,
 configuration_digest,work_type_key,title,created_by) values(
 '00000000-0000-4000-8000-000000001401','00000000-0000-4000-8000-000000001201',
 '00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000001302',
 repeat('a',64),'technical-delivery','Fictional subcontract delegate probe',
 '00000000-0000-4000-8000-000000001103');
insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id)
 values('00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000001401',
 'rybex-fictional-sub-delegate');
insert into d5o_hosted.subcontract_states(workspace_id,work_id,revision,state) values(
 '00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000001401',3,
 pg_catalog.jsonb_build_object(
  'allocations',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'id','00000000-0000-4000-8000-000000001501','status','Prepared','capMinor',100000,
   'currency','USD','preparedBy','00000000-0000-4000-8000-000000001103','preparedAt',now())),
  'agreements',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'id','00000000-0000-4000-8000-000000001502','status','Prepared','amountMinor',50000,
   'currency','USD','preparedBy','00000000-0000-4000-8000-000000001103','preparedAt',now())),
  'variations',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
   'id','00000000-0000-4000-8000-000000001503','status','Prepared','deltaMinor',-25000,
   'agreementId','00000000-0000-4000-8000-000000001502',
   'preparedBy','00000000-0000-4000-8000-000000001103','preparedAt',now())),
  'deliverables','[]'::jsonb,'invoices','[]'::jsonb));
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
do $$
declare category_key text; revision integer:=0;
begin
 foreach category_key in array array['subcontract_allocation','subcontract_agreement','subcontract_variation'] loop
  perform public.d5o_spending_delegate_command_v1('rybex','add',
   pg_catalog.jsonb_build_object('category',category_key,'role','admin','kind','delegate',
    'actorId','00000000-0000-4000-8000-000000001102','maxMinor','100000','currency','USD',
    'priority','100','validFrom',current_date,'validUntil',current_date+30,
    'sourceReference','FICTIONAL-SUB-DELEGATION-TEST'),
   'fictional-sub-delegation-'||category_key,revision);
  revision:=revision+1;
 end loop;
end $$;
do $$
declare r jsonb; focus text; subject uuid;
begin
 foreach focus in array array['subcontract-review-allocation','subcontract-review-agreement','subcontract-review-variation'] loop
  subject:=case focus when 'subcontract-review-allocation' then '00000000-0000-4000-8000-000000001501'::uuid
   when 'subcontract-review-agreement' then '00000000-0000-4000-8000-000000001502'::uuid
   else '00000000-0000-4000-8000-000000001503'::uuid end;
  r:=public.d5o_subcontract_my_review_v1('rybex','rybex-fictional-sub-delegate',focus,subject);
  if r->>'canReview'<>'false' or r->>'pending'<>'true' then raise exception 'wrong route % %',focus,r; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001102',true);
  r:=public.d5o_subcontract_my_review_v1('rybex','rybex-fictional-sub-delegate',focus,subject);
  if r->>'canReview'<>'true' then raise exception 'selected route % %',focus,r; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
 end loop;
end $$;
reset role;
create temporary table subcontract_delegate_probe(workspace_id uuid,work_id uuid,state jsonb);
create trigger check_delegate before update on subcontract_delegate_probe
 for each row execute function d5o_hosted.guard_subcontract_delegate_v1();
insert into subcontract_delegate_probe select workspace_id,work_id,state from d5o_hosted.subcontract_states;
grant select,update on subcontract_delegate_probe to authenticated;
set local role authenticated;
do $$
declare section text; decision text;
begin
 foreach section in array array['allocations','agreements','variations'] loop
  decision:=case when section='variations' then 'Returned' else 'Approved' end;
  perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
  begin
   update subcontract_delegate_probe set state=pg_catalog.jsonb_set(state,array[section,'0','status'],to_jsonb(decision));
   raise exception 'wrong actor decided %',section;
  exception when insufficient_privilege then
   raise notice 'wrong actor rejected %',section;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001102',true);
  update subcontract_delegate_probe set state=pg_catalog.jsonb_set(state,array[section,'0','status'],to_jsonb(decision));
  if not exists(select 1 from subcontract_delegate_probe where state#>>array[section,'0','status']=decision)
   then raise exception 'selected actor not applied %',section; end if;
 end loop;
end $$;
rollback;
