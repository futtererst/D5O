-- Retain an optional, exact private source for a prepared Design cost claim.
-- This does not certify employee hours or change the existing cost decision.
create table d5o_hosted.design_cost_evidence (
 id uuid primary key,
 workspace_id uuid not null references d5o_hosted.workspaces(id),
 work_id uuid not null references d5o_hosted.work_records(id),
 claim_id uuid not null unique references d5o_hosted.design_cost_claims(id),
 object_path text not null unique,
 storage_object_id uuid not null unique,
 storage_updated_at timestamptz not null,
 checksum_sha256 text not null check(checksum_sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 filename text not null,
 uploaded_by uuid not null references auth.users(id),
 uploaded_at timestamptz not null default now(),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.design_cost_evidence enable row level security;
revoke all on d5o_hosted.design_cost_evidence from public,anon,authenticated,service_role;

create function public.d5o_hosted_register_design_cost_evidence_v1(
 p_workspace_key text,p_presentation_id text,p_claim_id uuid,p_evidence_id uuid,
 p_checksum_sha256 text,p_filename text,p_uploader_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ws uuid; w d5o_hosted.work_records%rowtype;
 c d5o_hosted.design_cost_claims%rowtype; m d5o_hosted.memberships%rowtype;
 obj storage.objects%rowtype; path text;
begin
 if current_setting('role',true)<>'service_role' or p_evidence_id is null or p_claim_id is null
  or p_checksum_sha256 !~ '^[0-9a-f]{64}$' or length(coalesce(p_filename,'')) not between 1 and 200
  then raise exception 'invalid_design_cost_evidence' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select r.* into w from d5o_hosted.work_records r join d5o_hosted.work_identity_links l
  on l.workspace_id=r.workspace_id and l.work_id=r.id
  where r.workspace_id=ws and l.presentation_id=p_presentation_id for share of r;
 select * into m from d5o_hosted.memberships where workspace_id=ws and actor_user_id=p_uploader_id
  and status='active' and role='project_manager' for share;
 select * into c from d5o_hosted.design_cost_claims where id=p_claim_id and workspace_id=ws
  and work_id=w.id for update;
 if w.id is null or m.id is null or w.created_by<>p_uploader_id or c.id is null
  or c.status<>'Prepared' or c.prepared_by<>p_uploader_id
  then raise exception 'design_cost_evidence_scope_denied' using errcode='42501'; end if;
 path:=p_workspace_key||'/'||pg_catalog.encode(extensions.digest(p_presentation_id,'sha256'),'hex')
  ||'/design-cost/'||p_evidence_id::text;
 select * into obj from storage.objects where bucket_id='d5o-deploy-evidence' and name=path;
 if obj.id is null or obj.metadata->>'mimetype'<>'application/pdf'
  or (obj.metadata->>'size')::bigint not between 1 and 10485760
  then raise exception 'design_cost_evidence_object_missing' using errcode='23514'; end if;
 insert into d5o_hosted.design_cost_evidence(id,workspace_id,work_id,claim_id,object_path,
  storage_object_id,storage_updated_at,checksum_sha256,size_bytes,filename,uploaded_by)
 values(p_evidence_id,ws,w.id,p_claim_id,path,obj.id,obj.updated_at,p_checksum_sha256,
  (obj.metadata->>'size')::bigint,p_filename,p_uploader_id);
 return pg_catalog.jsonb_build_object('evidenceId',p_evidence_id,'claimId',p_claim_id,
  'checksumSha256',p_checksum_sha256,'filename',p_filename);
end; $$;
revoke all on function public.d5o_hosted_register_design_cost_evidence_v1(text,text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.d5o_hosted_register_design_cost_evidence_v1(text,text,uuid,uuid,text,text,uuid)
 to service_role;

create function public.d5o_hosted_design_cost_evidence_read_v1(
 p_workspace_key text,p_presentation_id text,p_claim_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e d5o_hosted.design_cost_evidence%rowtype; obj storage.objects%rowtype;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'server_only' using errcode='42501'; end if;
 select x.* into e from d5o_hosted.design_cost_evidence x
  join d5o_hosted.workspaces ws on ws.id=x.workspace_id
  join d5o_hosted.work_identity_links l on l.workspace_id=x.workspace_id and l.work_id=x.work_id
  where ws.workspace_key=p_workspace_key and l.presentation_id=p_presentation_id and x.claim_id=p_claim_id;
 if e.id is null then return null; end if;
 select * into obj from storage.objects where bucket_id='d5o-deploy-evidence' and name=e.object_path;
 if obj.id is distinct from e.storage_object_id or obj.updated_at is distinct from e.storage_updated_at
  or (obj.metadata->>'size')::bigint is distinct from e.size_bytes
  or obj.metadata->>'mimetype' is distinct from 'application/pdf'
  then raise exception 'design_cost_evidence_changed' using errcode='23514'; end if;
 return pg_catalog.jsonb_build_object('evidenceId',e.id,'claimId',e.claim_id,
  'objectPath',e.object_path,'checksumSha256',e.checksum_sha256,'sizeBytes',e.size_bytes,
  'filename',e.filename,'uploadedBy',e.uploaded_by,'uploadedAt',e.uploaded_at);
end; $$;
revoke all on function public.d5o_hosted_design_cost_evidence_read_v1(text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.d5o_hosted_design_cost_evidence_read_v1(text,text,uuid) to service_role;
