"""Independently verify actual local ledger against RC5/RC7 and frozen files."""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EV=ROOT/'docs/release/evidence'
target=json.loads(subprocess.run(['docker','inspect','d5o-rc7-historical-db'],capture_output=True,text=True,check=True).stdout)[0]
assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
sql="select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version) t"
run=subprocess.run(['docker','exec','d5o-rc7-historical-db','psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At','-c',sql],capture_output=True,text=True,encoding='utf-8',check=True)
rows={r['version']:r for r in map(json.loads,run.stdout.splitlines())}
if len(rows)!=202:raise RuntimeError('202 actual ledger rows required')
prior=json.loads((EV/'D5O_RC5_PRODUCTION_LEDGER.json').read_text())['rows']
comparison=json.loads((EV/'D5O_RC8_RETAINED_SQL_COMPARISON_UTF8.json').read_text())['rows']
prior_map={r['version']:r for r in prior}
if len(prior_map)!=177:raise RuntimeError('historical ledger baseline mismatch')
for version,p in prior_map.items():
    r=rows.get(version)
    if not r or r['name']!=p['name'] or len(r['statements'])!=p['statement_count']:
        raise RuntimeError('historical version/name/statement-count changed')
linked={r['hosted_version']:r for r in comparison if r['hosted_version']}
linked_checked=0; prior_hash_mismatches=[]
for version,prior_row in linked.items():
    actual=hashlib.sha256(''.join(rows[version]['statements']).encode()).hexdigest()
    if actual!=prior_row['retained_sql_sha256']:
        prior_hash_mismatches.append(version)
    else: linked_checked+=1
manifest=json.loads((EV/'D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations'][211:]
for item in manifest:
    r=rows.get(item['version'])
    if not r or r['name']!=item['filename'].split('_',1)[1].removesuffix('.sql'):
        raise RuntimeError('new ledger version/name mismatch')
    source=(ROOT/'supabase/migrations'/item['filename']).read_bytes().decode('utf-8')
    if hashlib.sha256(source.encode()).hexdigest()!=item['sha256']:
        raise RuntimeError('frozen source hash changed')
    if item['order']==215:
        expected=[(ROOT/'scripts/rc8_bridge_pre_215.sql').read_text(),source,
                  (ROOT/'scripts/rc8_bridge_post_215.sql').read_text()]
    else: expected=[source]
    if r['statements']!=expected:
        raise RuntimeError('ledger SQL mismatch at source order '+str(item['order'])+
            ', actual_lengths='+str(list(map(len,r['statements'])))+
            ', expected_lengths='+str(list(map(len,expected))))
result={'format':'d5o-rc8-ledger-verification-v1','historical_rows_preserved_version_name_statement_count':177,
  'historical_rows_retained_sql_hash_checked':linked_checked,
  'corrected_utf8_sql_hash_mismatch_versions':prior_hash_mismatches,
  'legacy_rows_without_prior_retained_sql_hash':177-len(linked),
  'new_migrations_exact_frozen_sql_verified':25,'order_215_actual_statement_count':3,
  'order_215_contains_pre_frozen_post':True,'total_ledger_rows':202,'fabricated_entries':False}
(EV/'D5O_RC8_LEDGER_VERIFICATION.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
