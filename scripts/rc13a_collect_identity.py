"""Sanitized local release identity and checksum preflight; never reads secrets."""
import hashlib, json, subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs/release/evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations']
assert len(manifest) == 236
bad = [m['filename'] for m in manifest if hashlib.sha256((root / 'supabase/migrations' / m['filename']).read_bytes()).hexdigest() != m['sha256']]
assert not bad, f'migration hash drift: {len(bad)}'
bridges = {name: hashlib.sha256((root / 'scripts' / name).read_bytes()).hexdigest() for name in
           ('rc8_bridge_pre_215.sql', 'rc8_bridge_post_215.sql')}
assert bridges == {
    'rc8_bridge_pre_215.sql': '0f076c496f756b8f56965b104cddd8c77c558344c89ca84cbf85946dfa924af5',
    'rc8_bridge_post_215.sql': 'b15dcd56a30fc4b46e81ea792fbfd51e19213630b698bd5734334f0cccbdf5d8'}
def db(name, sql):
    p = subprocess.run(['docker','exec',name,'psql','-U','supabase_admin','-d','postgres','-At','-c',sql],
                       capture_output=True,text=True,check=True)
    return p.stdout.strip()
original = db('d5o-rc7-recovery-db', 'select count(*) from supabase_migrations.schema_migrations')
upgraded = db('d5o-rc7-historical-db', 'select count(*) from supabase_migrations.schema_migrations')
counts = db('d5o-rc7-historical-db', "select (select count(*) from auth.schema_migrations),(select count(*) from auth.users),(select count(*) from storage.objects),(select count(*) from pg_constraint where contype='f' and not convalidated),(select count(*) from pg_policies where schemaname='storage' and tablename='objects'),(select relrowsecurity from pg_class where oid='storage.objects'::regclass)").split('|')
assert original == '177' and upgraded == '202' and counts[0] == '82' and counts[2] == '23' and counts[3:] == ['0','0','t']
out = {'format':'d5o-rc13a-local-identity-v1','source_commit':'d2a06ed796789dc8395386f067ef85545acf586a',
       'frozen_application_ancestor':'8b6b0d9e4aa484d0f0db1d075a969b79e01b0989',
       'migration_files':236,'source_hash_mismatches':0,'bridge_sha256':bridges,
       'original_ledger':int(original),'forward_migrations_applied':25,'upgraded_ledger':int(upgraded),
       'auth_provider_ledger':int(counts[0]),'auth_users_including_fictional':int(counts[1]),
       'private_storage_objects_after_synthetic_cleanup':int(counts[2]),
       'unvalidated_foreign_keys':int(counts[3]),'storage_select_policies':int(counts[4]),
       'storage_rls':counts[5]=='t','production_modified':False}
(root/'docs/release/evidence/D5O_RC13A_LOCAL_IDENTITY.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
