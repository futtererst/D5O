-- Replay receipts for atomic package creation. The package source of truth and
-- command are installed by the immediately following projection migration.
create table d5o_hosted.connected_package_receipts (
  workspace_id uuid not null,command_id text not null,work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),fingerprint text not null,
  result jsonb not null,primary key(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_package_receipts enable row level security;
revoke all on d5o_hosted.connected_package_receipts from public,anon,authenticated,service_role;
