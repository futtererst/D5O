-- The shared guard runs on authority, commitment and reservation row types.
-- PL/pgSQL boolean evaluation must not access a field absent on another type.
create or replace function d5o_hosted.guard_combined_work_authority_v1() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare ws uuid; w uuid; cap bigint; design_used bigint; po_used bigint;
 sub_used bigint; labor_used bigint; source jsonb;
begin
 ws:=new.workspace_id; w:=new.work_id;
 if tg_table_name='subcontract_reservations' then
  if new.amount_minor<0 then return new; end if;
 end if;
 if tg_table_name='design_spend_commitments' then
  if new.status<>'Approved' then return new; end if;
 end if;
 if tg_table_name='labor_reservations' then
  if new.status<>'Active' then return new; end if;
 end if;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select parent_cap_minor into cap from d5o_hosted.purchase_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 if cap is null then
  if tg_table_name in ('subcontract_reservations','labor_reservations') then
   raise exception 'current_work_economic_authority_required' using errcode='23514';
  end if;
  return new;
 end if;
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into po_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
  where workspace_id=ws and work_id=w;
 labor_used:=d5o_hosted.labor_exposure_v1(ws,w);
 if design_used+po_used+sub_used+labor_used>cap then
  raise exception 'work_economic_cap_exceeded' using errcode='23514'; end if;
 return new;
end; $$;
