"""Sanitized object-effect triage for 44 early and 10 legacy SQL histories."""
import hashlib,json,re,subprocess
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EV=ROOT/'docs/release/evidence'
manifest=json.loads((EV/'D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations']
early=manifest[:44]
psql=['docker','exec','d5o-rc7-historical-db','psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At']
for container in ['d5o-rc7-historical-db','d5o-rc7-recovery-db']:
    target=json.loads(subprocess.run(['docker','inspect',container],capture_output=True,text=True,check=True).stdout)[0]
    assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
sql="select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations where version in ('001','002','003','004','005','006','007','008','009','010') order by version) t"
run=subprocess.run(psql+['-c',sql],capture_output=True,text=True,encoding='utf-8',check=True)
legacy=list(map(json.loads,run.stdout.splitlines()))
assert len(legacy)==10
pattern=re.compile(r'(?im)^\s*(create|alter|drop)\s+(?:or\s+replace\s+)?(schema|table|view|materialized\s+view|function|procedure|trigger|index|policy|type)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?([A-Za-z_][A-Za-z_0-9.\"]*)')
def effects(text):
    found=[]
    for verb,kind,raw in pattern.findall(text):
        name=raw.strip('"').lower()
        if kind.lower() in ('table','view','function','procedure','type','index') and '.' not in name:name='public.'+name
        found.append({'verb':verb.upper(),'kind':kind.upper(),'object':name})
    return found
source=[{'order':m['order'],'source_version':m['version'],'source_file':m['filename'],
  'source_sha256':m['sha256'],'effects':effects((ROOT/'supabase/migrations'/m['filename']).read_text(encoding='utf-8'))} for m in early]
hosted=[{'hosted_version':r['version'],'hosted_name':r['name'],
  'retained_sql_sha256':hashlib.sha256(''.join(r['statements']).encode()).hexdigest(),
  'statement_count':len(r['statements']),'effects':effects('\n'.join(r['statements']))} for r in legacy]
legacy_objects={x['object'] for r in hosted for x in r['effects']}
for row in source:
    objects={x['object'] for x in row['effects']}
    row['overlap_with_legacy_object_names']=len(objects & legacy_objects)
    row['source_object_name_count']=len(objects)
out={'format':'d5o-rc9-historical-object-effects-v1',
 'warning':'Static SQL object-name extraction is not migration-history or effective-definition proof.',
 'early_source':source,'legacy_hosted':hosted,
 'totals':{'early':len(source),'legacy':len(hosted),
   'early_unique_object_names':len({x['object'] for r in source for x in r['effects']}),
   'legacy_unique_object_names':len(legacy_objects)}}
(EV/'D5O_RC9_HISTORICAL_OBJECT_EFFECTS.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out['totals']))
