-- Supervisor custody is limited to documents that actor supplied. The server
-- applies this uploader identity to both discovery and byte retrieval.
create or replace function public.d5o_hosted_customer_decision_evidence_read_v1(
  p_workspace_key text,p_presentation_id text,p_evidence_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_evidence d5o_hosted.customer_decision_evidence%rowtype;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'server_only' using errcode='42501'; end if;
  select e.* into v_evidence from d5o_hosted.customer_decision_evidence e
    join d5o_hosted.workspaces w on w.id=e.workspace_id
    where w.workspace_key=p_workspace_key and e.presentation_id=p_presentation_id
      and e.id=p_evidence_id;
  if not found then raise exception 'evidence_missing' using errcode='23503'; end if;
  return pg_catalog.jsonb_build_object('objectPath',v_evidence.object_path,
    'checksumSha256',v_evidence.checksum_sha256,'filename',v_evidence.filename,
    'uploadedBy',v_evidence.uploaded_by);
end; $$;
revoke all on function public.d5o_hosted_customer_decision_evidence_read_v1(
  text,text,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_customer_decision_evidence_read_v1(
  text,text,uuid) to service_role;

create or replace function public.d5o_hosted_private_evidence_index_v1(
  p_workspace_key text, p_offset integer default 0, p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'server_only' using errcode='42501';
  end if;
  if p_offset<0 or p_limit<1 or p_limit>100 then
    raise exception 'invalid_page' using errcode='22023';
  end if;
  select coalesce(pg_catalog.jsonb_agg(to_jsonb(r) order by r.uploaded_at desc,r.id), '[]'::jsonb)
    into v_rows from (
      select e.id::text id,e.presentation_id work_id,e.purpose kind,
        e.scope_id scope_id,null::text document_id,e.scope_revision revision,
        e.filename,e.checksum_sha256,e.size_bytes,e.uploaded_at,e.uploaded_by
      from d5o_hosted.customer_decision_evidence e
      join d5o_hosted.workspaces w on w.id=e.workspace_id
      where w.workspace_key=p_workspace_key and w.status='active'
      union all
      select e.id::text id,e.presentation_id work_id,'design-document'::text kind,
        null::text scope_id,e.document_id,e.document_revision revision,
        e.filename,e.checksum_sha256,e.size_bytes,e.uploaded_at,e.uploaded_by
      from d5o_hosted.design_document_evidence e
      join d5o_hosted.workspaces w on w.id=e.workspace_id
      where w.workspace_key=p_workspace_key and w.status='active'
      order by uploaded_at desc,id
      offset p_offset limit p_limit
    ) r;
  return v_rows;
end; $$;
revoke all on function public.d5o_hosted_private_evidence_index_v1(text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_private_evidence_index_v1(text,integer,integer)
  to service_role;

