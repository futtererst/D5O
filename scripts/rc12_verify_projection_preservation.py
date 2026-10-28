"""Check original JSON Work/catalog entries survive synthetic lifecycle creation."""
import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def get(container):
 sql="select row_to_json(t)::text from (select workspace_id,state_key,revision,state_json from d5o_hosted.prototype_states order by workspace_id,state_key) t"
 r=subprocess.run(['docker','exec',container,'psql','-U','supabase_admin','-d','postgres','-At','-c',sql],capture_output=True,text=True,encoding='utf-8',check=True)
 return {(x['workspace_id'],x['state_key']):x for x in (json.loads(line) for line in r.stdout.splitlines() if line)}
old,new=get('d5o-rc7-recovery-db'),get('d5o-rc7-historical-db')
out=[]
for key,row in old.items():
 current=new.get(key)
 if not current:raise RuntimeError('historical state row missing')
 before=row['state_json'];after=current['state_json']
 arrays=[]
 for field in ('records','packages'):
  prior=before.get(field,[]);now=after.get(field,[])
  if not isinstance(prior,list) or not isinstance(now,list):continue
  lookup={str(x.get('id')):x for x in now if isinstance(x,dict) and x.get('id') is not None}
  missing=sum(1 for x in prior if isinstance(x,dict) and str(x.get('id')) not in lookup)
  changed=sum(1 for x in prior if isinstance(x,dict) and str(x.get('id')) in lookup and x!=lookup[str(x.get('id'))])
  arrays.append({'field':field,'historical_entries':len(prior),'tested_entries':len(now),'missing_historical_entries':missing,'modified_historical_entries':changed})
 out.append({'state_key':key[1],'original_revision':row['revision'],'tested_revision':current['revision'],'arrays':arrays})
result={'format':'d5o-rc12-projection-preservation-v1','states':out,'all_historical_entries_preserved':all(a['missing_historical_entries']==0 and a['modified_historical_entries']==0 for s in out for a in s['arrays']),'values_disclosed':False}
(ROOT/'docs/release/evidence/D5O_RC12_PROJECTION_PRESERVATION.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'states':len(out),'allPreserved':result['all_historical_entries_preserved'],'arrays':[{'state':s['state_key'],**a} for s in out for a in s['arrays']]}))
