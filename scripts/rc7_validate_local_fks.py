"""Read-only validation of restored foreign keys after data-only pg_restore."""
import json, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
target = json.loads(subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"], capture_output=True, text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none" and not target["HostConfig"].get("PortBindings")
base = ["docker", "exec", "d5o-rc7-historical-db", "psql", "-U", "supabase_admin", "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At"]
catalog_sql = """select row_to_json(q)::text from (
  select c.conname, n.nspname source_schema, t.relname source_table,
    rn.nspname target_schema, rt.relname target_table,
    array(select a.attname from unnest(c.conkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.ord) source_columns,
    array(select a.attname from unnest(c.confkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum order by k.ord) target_columns
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    join pg_class rt on rt.oid=c.confrelid join pg_namespace rn on rn.oid=rt.relnamespace
  where c.contype='f' and n.nspname in ('public','d5o_hosted','storage','auth')
  order by n.nspname,t.relname,c.conname) q"""
run = subprocess.run(base+["-c",catalog_sql],capture_output=True,text=True,check=True)
fks = list(map(json.loads,run.stdout.splitlines()))
def quote(s): return '"'+s.replace('"','""')+'"'
violations = []
for i in range(0,len(fks),60):
    group=fks[i:i+60]
    parts=[]
    for j,r in enumerate(group):
        s=quote(r['source_schema'])+'.'+quote(r['source_table'])
        t=quote(r['target_schema'])+'.'+quote(r['target_table'])
        pairs=list(zip(r['source_columns'],r['target_columns']))
        join=' and '.join('s.'+quote(a)+'=t.'+quote(b) for a,b in pairs)
        present=' and '.join('s.'+quote(a)+' is not null' for a,b in pairs)
        missing='t.'+quote(pairs[0][1])+' is null'
        parts.append(f"select {i+j} as ordinal,count(*) as n from {s} s left join {t} t on {join} where {present} and {missing}")
    sql='select ordinal,n from ('+' union all '.join(parts)+') x where n>0 order by ordinal'
    check=subprocess.run(base+["-c",sql],capture_output=True,text=True)
    if check.returncode: raise RuntimeError('local FK validation query failed')
    for line in check.stdout.splitlines():
        ordinal,n=map(int,line.split('|'))
        r=fks[ordinal]
        violations.append({"constraint":r['source_schema']+'.'+r['source_table']+'.'+r['conname'],"orphan_rows":n})
out={"format":"d5o-rc7-local-fk-validation-v1","constraints_checked":len(fks),"violations":violations}
(ROOT/'docs/release/evidence/D5O_RC7_LOCAL_FK_VALIDATION.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({"constraintsChecked":len(fks),"violations":len(violations),"orphanRows":sum(x['orphan_rows'] for x in violations)}))
