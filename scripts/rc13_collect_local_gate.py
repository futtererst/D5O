"""Record only source hashes, ledger counts, ACL aggregates and local isolation metadata."""
import hashlib, json, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'docs/release/evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations']
if len(manifest) != 236:
    raise RuntimeError('manifest count drift')
for item in manifest:
    if hashlib.sha256((ROOT / 'supabase/migrations' / item['filename']).read_bytes()).hexdigest() != item['sha256']:
        raise RuntimeError('source migration hash drift')
bridges = {name: hashlib.sha256((ROOT / 'scripts' / name).read_bytes()).hexdigest()
           for name in ('rc8_bridge_pre_215.sql', 'rc8_bridge_post_215.sql')}
if bridges != {'rc8_bridge_pre_215.sql': '0f076c496f756b8f56965b104cddd8c77c558344c89ca84cbf85946dfa924af5',
               'rc8_bridge_post_215.sql': 'b15dcd56a30fc4b46e81ea792fbfd51e19213630b698bd5734334f0cccbdf5d8'}:
    raise RuntimeError('qualified bridge hash drift')
def command(args):
    return subprocess.run(args, capture_output=True, text=True, check=True, encoding='utf-8').stdout.strip()
db = 'd5o-rc7-historical-db'
sql = "select (select count(*) from supabase_migrations.schema_migrations),(select count(*) from auth.schema_migrations),(select count(*) from auth.users),(select count(*) from auth.identities),(select count(*) from d5o_hosted.work_records),(select count(*) from storage.objects),(select count(*) from pg_constraint where contype='f' and not convalidated),(select count(*) from pg_policies where schemaname='storage' and tablename='objects'),(select relrowsecurity from pg_class where oid='storage.objects'::regclass)"
counts = command(['docker', 'exec', db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-F', '|', '-c', sql]).split('|')
if len(counts) != 9 or counts[0] != '202' or counts[1] != '82' or counts[5] != '23' or counts[6] != '0' or counts[7:] != ['0', 't']:
    raise RuntimeError('local database gate mismatch')
inspect = json.loads(command(['docker', 'inspect', db]))[0]
networks = list(inspect['NetworkSettings']['Networks'])
if networks != ['d5o-rc13-net']:
    raise RuntimeError('disposable database network mismatch')
if 'fcawktdjoxvahhgvkebx' in json.dumps(inspect['Config']['Env']):
    raise RuntimeError('production project reference in disposable database environment')
out = {'format': 'd5o-rc13-local-identity-v1', 'base_commit': 'f1cb523636be83fef8b44d36dfc4052c48b52da5',
       'frozen_application_commit': '8b6b0d9e4aa484d0f0db1d075a969b79e01b0989',
       'source_migration_files': 236, 'source_hash_mismatches': 0, 'qualified_bridge_sha256': bridges,
       'local_database': 'fresh 177-to-202 production-derived restore', 'source_ledger': int(counts[0]),
       'auth_provider_ledger': int(counts[1]), 'auth_users_including_fictional': int(counts[2]),
       'auth_identities_including_fictional': int(counts[3]), 'canonical_work_including_fictional': int(counts[4]),
       'storage_objects': int(counts[5]), 'unvalidated_foreign_keys': int(counts[6]),
       'storage_objects_select_policies': int(counts[7]), 'storage_objects_rls_enabled': counts[8] == 't',
       'database_docker_network': networks, 'production_credentials_in_database_environment': False}
(ROOT / 'docs/release/evidence/D5O_RC13_LOCAL_IDENTITY.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out))
