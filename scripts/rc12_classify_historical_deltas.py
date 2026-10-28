"""Classify changed column names on original protected rows; emit no values."""
import collections,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
tables={
 'd5o_hosted.admin_identity_requests':('workspace_id','command_id'),
 'd5o_hosted.configuration_versions':('id',),
 'd5o_hosted.connected_crew_profiles':('workspace_id','id'),
 'd5o_hosted.memberships':('id',),
 'd5o_hosted.workspaces':('id',),
 'storage.migrations':('id',),
}
def rows(container,table,keys):
 r=subprocess.run(['docker','exec',container,'psql','-U','supabase_admin','-d','postgres','-At','-c',f'select row_to_json(t)::text from {table} t'],capture_output=True,text=True,encoding='utf-8',check=True)
 data=[json.loads(line) for line in r.stdout.splitlines() if line]
 return {tuple(str(row[k]) for k in keys):row for row in data}
out=[]
for table,keys in tables.items():
 old=rows('d5o-rc7-recovery-db',table,keys)
 new=rows('d5o-rc7-historical-db',table,keys)
 changed=collections.Counter();added=collections.Counter();modified=collections.Counter()
 for key,row in old.items():
  if key not in new:continue
  for field in row.keys()|new[key].keys():
   if row.get(field)!=new[key].get(field):
    changed[field]+=1
    (added if field not in row else modified)[field]+=1
 out.append({'table':table,'original_rows':len(old),'tested_rows':len(new),'missing_original_keys':len(old.keys()-new.keys()),'changed_fields_on_original_rows':dict(sorted(changed.items())),'new_schema_fields':dict(sorted(added.items())),'modified_existing_fields':dict(sorted(modified.items()))})
result={'format':'d5o-rc12-historical-column-delta-v1','reference':'original 177-entry encrypted checkpoint','tested':'202-entry upgrade after synthetic tests','tables':out,'values_disclosed':False}
(ROOT/'docs/release/evidence/D5O_RC12_HISTORICAL_COLUMN_DELTAS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(out))
