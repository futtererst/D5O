\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee0001','qa.admin.one@example.invalid',now()),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee0002','qa.bd.two@example.invalid',now()),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee0003','qa.admin.other@example.invalid',now()),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee0004','qa.bd.other@example.invalid',now());
insert into d5o_hosted.workspaces(id,workspace_key,display_name) values
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee1001','qa_succession_one','QA succession one'),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee1002','qa_succession_two','QA succession two');
insert into d5o_hosted.memberships(id,workspace_id,actor_user_id,role) values
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee2001','8ee098ee-8ee0-48ee-98ee-8ee098ee1001','8ee098ee-8ee0-48ee-98ee-8ee098ee0001','admin'),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee2002','8ee098ee-8ee0-48ee-98ee-8ee098ee1001','8ee098ee-8ee0-48ee-98ee-8ee098ee0002','business_development_lead'),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee2003','8ee098ee-8ee0-48ee-98ee-8ee098ee1002','8ee098ee-8ee0-48ee-98ee-8ee098ee0003','admin'),
  ('8ee098ee-8ee0-48ee-98ee-8ee098ee2004','8ee098ee-8ee0-48ee-98ee-8ee098ee1002','8ee098ee-8ee0-48ee-98ee-8ee098ee0004','business_development_lead');
set local role authenticated;
do $$ begin
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
      'qa.bd.two@example.invalid','grant',1,'Direct JWT cannot grant','direct-jwt-qa');
    raise exception 'authenticated_rpc_allowed';
  exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$
declare r jsonb; state text;
begin
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0002','8ee098ee-8ee0-48ee-98ee-8ee098ee2002',
      'qa.admin.one@example.invalid','grant',1,'Wrong role denial check','wrong-role-qa');
    raise exception 'wrong_role_grant_allowed';
  exception when insufficient_privilege then null; end;
  r:=public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
    '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
    'qa.bd.two@example.invalid','grant',1,'Independent test administrator','grant-qa-0001');
  if r->>'role'<>'admin' or r->>'revision'<>'2' then raise exception 'grant_result_wrong'; end if;
  r:=public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
    '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
    'qa.bd.two@example.invalid','grant',1,'Independent test administrator','grant-qa-0001');
  if r->>'replay'<>'true' then raise exception 'grant_replay_wrong'; end if;
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
      'qa.bd.other@example.invalid','grant',1,'Cross tenant test denial','cross-qa-0001');
    raise exception 'cross_tenant_grant_allowed';
  exception when foreign_key_violation then null; end;
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0003','8ee098ee-8ee0-48ee-98ee-8ee098ee2003',
      'qa.admin.one@example.invalid','restore',1,'Cross tenant admin denial','cross-qa-0002');
    raise exception 'cross_tenant_admin_allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
      'qa.bd.two@example.invalid','grant',1,'Stale revision denial','stale-qa-0001');
    raise exception 'stale_revision_allowed';
  exception when unique_violation then null; end;
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0002','8ee098ee-8ee0-48ee-98ee-8ee098ee2002',
      'qa.admin.one@example.invalid','restore',1,'Original admin protected','original-admin-qa');
    raise exception 'original_admin_restore_allowed';
  exception when insufficient_privilege then null; end;
  r:=public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
    '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
    'qa.bd.two@example.invalid','restore',2,'Return fictional test role','restore-qa-0001');
  if r->>'role'<>'business_development_lead' or r->>'revision'<>'3' then raise exception 'restore_result_wrong'; end if;
  r:=public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
    '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
    'qa.bd.two@example.invalid','restore',2,'Return fictional test role','restore-qa-0001');
  if r->>'replay'<>'true' then raise exception 'restore_replay_wrong'; end if;
  begin
    perform public.d5o_hosted_customer_admin_succession_v1('qa_succession_one',
      '8ee098ee-8ee0-48ee-98ee-8ee098ee0001','8ee098ee-8ee0-48ee-98ee-8ee098ee2001',
      'qa.admin.one@example.invalid','restore',1,'Last administrator denial','last-admin-qa');
    raise exception 'last_admin_restore_allowed';
  exception when foreign_key_violation then null; end;
end $$;
reset role;
do $$ begin
  if (select role from d5o_hosted.memberships where id='8ee098ee-8ee0-48ee-98ee-8ee098ee2002')<>'business_development_lead'
    or (select revision from d5o_hosted.memberships where id='8ee098ee-8ee0-48ee-98ee-8ee098ee2002')<>3
    or (select count(*) from d5o_hosted.org_admin_events where workspace_id='8ee098ee-8ee0-48ee-98ee-8ee098ee1001')<>2
    or (select count(*) from d5o_hosted.org_admin_receipts where workspace_id='8ee098ee-8ee0-48ee-98ee-8ee098ee1001')<>2
  then raise exception 'financial_or_audit_side_effect'; end if;
end $$;
rollback;
select 'customer_succession_regression_pass' as result;
