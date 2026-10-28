"""Compare ten historical discrepancy tables by stable keys; emit no row values or IDs."""
import collections, json, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TABLES={
 'auth.identities':('id',),
 'd5o_hosted.admin_identity_requests':('workspace_id','command_id'),
 'd5o_hosted.configuration_template_versions':('id',),
 'd5o_hosted.configuration_templates':('id',),
 'd5o_hosted.connected_phase_status':('workspace_id','work_id'),
 'd5o_hosted.prototype_states':('workspace_id','state_key'),
 'd5o_hosted.rc8_invitation_bridge_receipts':('bridge_key',),
 'd5o_hosted.spending_delegate_positions':('workspace_id',),
 'd5o_hosted.workspaces':('id',),
 'storage.migrations':('id',),
}
REFERENCE='d5o-rc7-recovery-db'
EXERCISED='d5o-rc7-historical-db'
def rows(container,table,keys):
    cmd=['docker','exec',container,'psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At','-c',f'select row_to_json(t)::text from {table} t']
    result=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8',check=True)
    out={}
    for line in result.stdout.splitlines():
        if not line:continue
        row=json.loads(line)
        key=tuple(str(row[k]) for k in keys)
        if key in out:raise RuntimeError(f'duplicate stable key in {table}')
        out[key]=row
    return out
results=[]
for table,keys in TABLES.items():
    if len(sys.argv)>1 and sys.argv[1]=='original_to_upgrade':
        check=subprocess.run(['docker','exec',REFERENCE,'psql','-U','supabase_admin','-d','postgres','-At','-c',f"select to_regclass('{table}') is not null"],capture_output=True,text=True,check=True)
        if check.stdout.strip()!='t':
            results.append({'table':table,'introduced_by_forward_migration':True})
            continue
    old=rows(REFERENCE,table,keys)
    new=rows(EXERCISED,table,keys)
    common=old.keys()&new.keys()
    changed=collections.Counter()
    affected=0
    for key in common:
        columns=old[key].keys() if len(sys.argv)>1 and sys.argv[1]=='original_to_upgrade' else old[key].keys()|new[key].keys()
        different=[column for column in columns if old[key].get(column)!=new[key].get(column)]
        if different:affected+=1;changed.update(different)
    results.append({'table':table,'reference_rows':len(old),'exercised_rows':len(new),
      'missing_original_keys':len(old.keys()-new.keys()),'added_keys':len(new.keys()-old.keys()),
      'changed_original_rows':affected,'changed_columns':dict(sorted(changed.items())),
      'new_columns_in_upgrade':sorted(new[next(iter(new))].keys()-old[next(iter(old))].keys()) if old and new and len(sys.argv)>1 and sys.argv[1]=='original_to_upgrade' else []})
out={'format':'d5o-rc15-ten-table-keyed-diff-v1','boundary':sys.argv[1] if len(sys.argv)>1 else 'unspecified',
     'reference':'independently restored and upgraded copy','exercised':'independently restored and upgraded copy',
     'values_or_identifiers_disclosed':False,'tables':results}
path=ROOT/'docs/release/evidence'/f'D5O_RC15_TEN_{out["boundary"].upper()}.json'
path.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'boundary':out['boundary'],'changed_tables':[r['table'] for r in results if r.get('missing_original_keys') or r.get('changed_original_rows')]}))
