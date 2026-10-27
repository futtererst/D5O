"""Build opaque identity fingerprints for the approved historical checkpoint."""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EV=ROOT/'docs/release/evidence'
target=json.loads(subprocess.run(['docker','inspect','d5o-rc7-historical-db'],capture_output=True,text=True,check=True).stdout)[0]
assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
psql=['docker','exec','d5o-rc7-historical-db','psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At']
def read(sql):return subprocess.run(psql+['-c',sql],capture_output=True,text=True,encoding='utf-8',check=True).stdout.strip()
queries={
 'ledger':"select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version) t",
 'workspaces':"select id::text from d5o_hosted.workspaces order by id",
 'auth_users':"select id::text from auth.users order by id",
 'storage_associations':"select id::text||'|'||bucket_id||'|'||name from storage.objects order by id",
 'legacy_invitation':"select workspace_id::text||'|'||command_id||'|'||requested_role||'|'||status||'|'||fingerprint from d5o_hosted.admin_identity_requests where action='invite' and requested_role='field_worker' and status='setup_completed'"
}
values={name:read(sql) for name,sql in queries.items()}
if len(values['ledger'].splitlines())!=177 or len(values['legacy_invitation'].splitlines())!=1:
    raise RuntimeError('approved historical copy mismatch')
out={'format':'d5o-rc9-approved-historical-start-v1','database':'postgres','ledger_rows':177,
  'fingerprints_sha256':{name:hashlib.sha256(value.encode()).hexdigest() for name,value in values.items()},
  'counts':{name:len(value.splitlines()) for name,value in values.items()}}
(EV/'D5O_RC9_START_FINGERPRINT.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'ledgerRows':177,'counts':out['counts'],'fingerprintRecorded':True}))
