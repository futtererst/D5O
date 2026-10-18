-- Database-only, rolled-back probe of the new PO delegation boundary.
-- It does not create a canonical business decision or bypass an existing trigger.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000101','fictional-po-admin-a@example.test'),
 ('00000000-0000-4000-8000-000000000102','fictional-po-admin-b@example.test'),
 ('00000000-0000-4000-8000-000000000103','fictional-po-pm@example.test');
insert into d5o_hosted.workspaces(id,workspace_key,display_name)
 values('00000000-0000-4000-8000-000000000201','rybex','Fictional Rybex');
insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','admin'),
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000102','admin'),
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000103','project_manager');
insert into d5o_hosted.configuration_tenants(id,workspace_id,status)
 values('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000201','active');
insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,effective_from,manifest_json)
 values('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000301',1,'draft',repeat('a',64),now(),
  '{"workTypes":[{"key":"technical-delivery"}]}');
insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
 values('00000000-0000-4000-8000-000000000302','technical-delivery','Technical delivery','active');
update d5o_hosted.configuration_versions set status='published'
 where id='00000000-0000-4000-8000-000000000302';
insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,
 configuration_digest,work_type_key,title,created_by) values(
 '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302',
 repeat('a',64),'technical-delivery','Fictional PO delegate probe',
 '00000000-0000-4000-8000-000000000103');
insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id)
 values('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000401',
 'rybex-fictional-po-delegate');
insert into d5o_hosted.graybar_states(workspace_id,work_id,revision,state) values(
 '00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000401',1,
 pg_catalog.jsonb_build_object('bom',null,'orders',pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object('id','00000000-0000-4000-8000-000000000501',
   'status','Prepared','preparedBy','00000000-0000-4000-8000-000000000103',
   'preparedAt',now(),'amountMinor',50000,'currency','USD')),
  'supplierInvoices','[]'::jsonb));
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
select public.d5o_spending_delegate_command_v1('rybex','add',
 pg_catalog.jsonb_build_object('category','purchase_order','role','admin','kind','delegate',
  'actorId','00000000-0000-4000-8000-000000000102','maxMinor','100000','currency','USD',
  'priority','100','validFrom',current_date,'validUntil',current_date+30,
  'sourceReference','FICTIONAL-PO-DELEGATION-TEST'),
 'fictional-po-delegation-command-001',0);
do $$
declare route jsonb; queue jsonb;
begin
 route:=public.d5o_purchase_order_my_review_v1('rybex','rybex-fictional-po-delegate',
  '00000000-0000-4000-8000-000000000501');
 if route->>'canReview'<>'false' or route->>'pending'<>'true' then
  raise exception 'wrong_actor_route_failed %',route; end if;
 queue:=public.d5o_graybar_actions_v1('rybex');
 if exists(select 1 from pg_catalog.jsonb_array_elements(queue) a
  where a->>'kind'='Approve Graybar PO') then raise exception 'wrong_actor_queue_failed'; end if;
 perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
 route:=public.d5o_purchase_order_my_review_v1('rybex','rybex-fictional-po-delegate',
  '00000000-0000-4000-8000-000000000501');
 if route->>'canReview'<>'true' then raise exception 'selected_actor_route_failed %',route; end if;
 queue:=public.d5o_graybar_actions_v1('rybex');
 if not exists(select 1 from pg_catalog.jsonb_array_elements(queue) a
  where a->>'kind'='Approve Graybar PO') then raise exception 'selected_actor_queue_failed'; end if;
end $$;
-- A temporary table exercises the same installed trigger function in isolation;
-- the existing commercial/source/cap trigger remains installed and untouched.
reset role;
create temporary table po_delegate_probe(workspace_id uuid,work_id uuid,state jsonb);
create trigger check_delegate before update on po_delegate_probe
 for each row execute function d5o_hosted.guard_purchase_order_delegate_v1();
insert into po_delegate_probe select workspace_id,work_id,state from d5o_hosted.graybar_states;
grant select,update on po_delegate_probe to authenticated;
set local role authenticated;
do $$
begin
 perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
 begin
  update po_delegate_probe set state=pg_catalog.jsonb_set(state,'{orders,0,status}','"Approved"');
  raise exception 'wrong_actor_approved';
 exception when insufficient_privilege then
  raise notice 'wrong actor rejected before approval';
 end;
 perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
 update po_delegate_probe set state=pg_catalog.jsonb_set(state,'{orders,0,status}','"Approved"');
 if not exists(select 1 from po_delegate_probe where state#>>'{orders,0,status}'='Approved')
 then raise exception 'selected actor did not pass'; end if;
end $$;
rollback;
