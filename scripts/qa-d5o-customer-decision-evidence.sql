-- Run only against the disposable, isolated D5O pilot database.
-- Every mutation is rolled back; customer documents and decisions are preserved.
begin;
do $$
declare e d5o_hosted.customer_decision_evidence%rowtype;
  rejected boolean;
begin
  select * into e from d5o_hosted.customer_decision_evidence
    where presentation_id='rybex-9e4f1e5f9e6b4e429142d3b01e1825e5'
      and purpose='package-acceptance' limit 1;
  if not found then raise exception 'pilot_package_document_missing'; end if;
  perform d5o_hosted.require_customer_decision_evidence_v1(
    e.workspace_id,e.work_id,e.id::text,e.purpose,e.scope_id,e.scope_revision,e.basis);

  rejected:=false;
  begin
    perform d5o_hosted.require_customer_decision_evidence_v1(
      e.workspace_id,e.work_id,gen_random_uuid()::text,e.purpose,e.scope_id,e.scope_revision,e.basis);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'fabricated_reference_accepted'; end if;

  rejected:=false;
  begin
    perform d5o_hosted.require_customer_decision_evidence_v1(
      e.workspace_id,gen_random_uuid(),e.id::text,e.purpose,e.scope_id,e.scope_revision,e.basis);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'wrong_work_document_accepted'; end if;

  rejected:=false;
  begin
    perform d5o_hosted.require_customer_decision_evidence_v1(
      e.workspace_id,e.work_id,e.id::text,e.purpose,e.scope_id,e.scope_revision+1,e.basis);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'stale_scope_document_accepted'; end if;

  rejected:=false;
  begin
    perform d5o_hosted.require_customer_decision_evidence_v1(
      e.workspace_id,e.work_id,e.id::text,e.purpose,'other-scope',e.scope_revision,e.basis);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'wrong_scope_document_accepted'; end if;

  update storage.objects set updated_at=updated_at+interval '1 second'
    where id=e.storage_object_id;
  rejected:=false;
  begin
    perform d5o_hosted.require_customer_decision_evidence_v1(
      e.workspace_id,e.work_id,e.id::text,e.purpose,e.scope_id,e.scope_revision,e.basis);
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'changed_storage_object_accepted'; end if;

  if pg_catalog.has_function_privilege('authenticated',
      'd5o_hosted.require_customer_decision_evidence_v1(uuid,uuid,text,text,text,integer,jsonb)',
      'EXECUTE') or pg_catalog.has_table_privilege('authenticated',
      'd5o_hosted.customer_decision_evidence','UPDATE') then
    raise exception 'direct_authenticated_evidence_mutation_allowed'; end if;
  raise notice 'customer_evidence_exact_scope_storage_and_privilege_checks_passed';
end $$;
rollback;
