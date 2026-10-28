"""Compare hashed historical row multisets with the exercised local upgrade.

Only digests and counts leave process memory; no production-derived row is written.
"""
import collections, hashlib, json, subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BEFORE='d5o-rc7-recovery-db'
AFTER='d5o-rc7-historical-db'
def query(container,sql):
    args=['docker','exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At','-F','|']
    r=subprocess.run(args,input=sql,capture_output=True,text=True,encoding='utf-8',check=True)
    return r.stdout.strip().splitlines() if r.stdout.strip() else []
tables=query(BEFORE,"select n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('auth','storage','public','d5o_hosted') order by 1;\n")
assert 150<len(tables)<400 and all(t.count('.')==1 for t in tables)
parts=[]
for table in tables:
    schema,name=table.split('.')
    assert schema.replace('_','').isalnum() and name.replace('_','').isalnum()
    parts.append(f"select '{table}' as table_name,md5(to_jsonb(t)::text) from {schema}.{name} t")
sql=' union all '.join(parts)+';\n'
def hashes(container):
    out=collections.defaultdict(collections.Counter)
    for line in query(container,sql):
        table,digest=line.rsplit('|',1)
        if table not in tables or len(digest)!=32:raise RuntimeError('unexpected digest row')
        out[table][digest]+=1
    return out
before,after=hashes(BEFORE),hashes(AFTER)
rows=[]
for table in tables:
    old,new=before[table],after[table]
    missing=sum(max(0,count-new[digest]) for digest,count in old.items())
    digest=hashlib.sha256('|'.join(f'{key}:{count}' for key,count in sorted(old.items())).encode()).hexdigest()
    rows.append({'table':table,'historical_rows':sum(old.values()),'tested_rows':sum(new.values()),'historical_multiset_sha256':digest,'missing_historical_row_signatures':missing})
result={'format':'d5o-rc12-historical-row-multiset-v1','reference':'fresh restored post-upgrade encrypted checkpoint; network none','tested':'upgraded historical database after only synthetic Auth/Work tests','tables':rows,'all_reference_row_signatures_present':all(x['missing_historical_row_signatures']==0 for x in rows),'tables_with_missing_signatures':[x['table'] for x in rows if x['missing_historical_row_signatures']],'production_modified':False}
(ROOT/'docs/release/evidence/D5O_RC12_HISTORICAL_ROW_DIGESTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'tables':len(rows),'allPreserved':result['all_reference_row_signatures_present'],'exceptions':result['tables_with_missing_signatures']}))
