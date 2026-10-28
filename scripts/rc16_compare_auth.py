"""Compare original Auth identities by stable IDs; emit counts and changed columns only."""
import collections,json,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def rows(container,table):
    r=subprocess.run(['docker','exec',container,'psql','-U','supabase_admin','-d','postgres','-q','-X','-At','-v','ON_ERROR_STOP=1','-c',f'select row_to_json(t)::text from {table} t'],capture_output=True,text=True,encoding='utf-8',check=True)
    out={}
    for line in r.stdout.splitlines():
        if not line:continue
        row=json.loads(line)
        if row['id'] in out:raise RuntimeError('duplicate identity key')
        out[row['id']]=row
    return out
old=rows('d5o-rc7-recovery-db','auth.identities')
new=rows('d5o-rc7-historical-db','auth.identities')
assert len(old)==25
changed=collections.Counter(); changed_rows=0
for key in old.keys()&new.keys():
    cols=[column for column in old[key].keys()|new[key].keys() if old[key].get(column)!=new[key].get(column)]
    if cols:changed_rows+=1;changed.update(cols)
relation_fields=['user_id','provider_id','provider']
relation_changes=sum(any(old[key].get(f)!=new[key].get(f) for f in relation_fields) for key in old.keys()&new.keys())
out={'format':'d5o-rc16-auth-identity-boundary-v1','boundary':sys.argv[1],
 'originalIdentityCount':len(old),'currentIdentityCount':len(new),
 'missingOriginalKeys':len(old.keys()-new.keys()),'newKeys':len(new.keys()-old.keys()),
 'changedOriginalRows':changed_rows,'changedColumns':dict(sorted(changed.items())),
 'ownershipProviderRelationshipChanges':relation_changes,'valuesOrIdentifiersDisclosed':False}
path=ROOT/'docs/release/evidence'/f'D5O_RC16_AUTH_{sys.argv[1].upper()}.json'
path.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
