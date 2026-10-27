"""Compare frozen clean and historical-upgraded effective catalogs, sans SQL text."""
import hashlib,json,subprocess,sys
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EV=ROOT/'docs/release/evidence'
if len(sys.argv)!=2 or not sys.argv[1].startswith('supabase_db_d5o-p0a-'):
    raise RuntimeError('expected isolated disposable clean database container')
clean=sys.argv[1];historical='d5o-rc7-recovery-db'
for container in (clean,historical):
    target=json.loads(subprocess.run(['docker','inspect',container],capture_output=True,text=True,check=True).stdout)[0]
    if container==historical and (target['HostConfig']['NetworkMode']!='none' or target['HostConfig'].get('PortBindings')):
        raise RuntimeError('historical comparator not network isolated')
queries={
'relation':"""select row_to_json(x)::text from (select n.nspname||'.'||c.relname key,c.relkind::text definition,pg_get_userbyid(c.relowner) owner,coalesce(c.relacl::text,'') acl,c.relrowsecurity rls,c.relforcerowsecurity force_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','d5o_hosted') and c.relkind in ('r','p','v','m') order by 1) x""",
'column':"""select row_to_json(x)::text from (select n.nspname||'.'||c.relname||'.'||a.attname key,format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||'|'||a.attgenerated::text definition from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname in ('public','d5o_hosted') and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped order by 1) x""",
'constraint':"""select row_to_json(x)::text from (select n.nspname||'.'||c.relname||'.'||q.conname key,pg_get_constraintdef(q.oid,true)||'|'||q.convalidated||'|'||q.condeferrable definition from pg_constraint q join pg_class c on c.oid=q.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','d5o_hosted') order by 1) x""",
'index':"""select row_to_json(x)::text from (select n.nspname||'.'||c.relname key,pg_get_indexdef(c.oid)||'|'||i.indisunique||'|'||i.indisvalid definition from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','d5o_hosted') order by 1) x""",
'trigger':"""select row_to_json(x)::text from (select n.nspname||'.'||c.relname||'.'||t.tgname key,pg_get_triggerdef(t.oid,true)||'|'||t.tgenabled::text definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','d5o_hosted') and not t.tgisinternal order by 1) x""",
'function':"""select row_to_json(x)::text from (select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' key,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,coalesce(p.proacl::text,'') acl,p.prosecdef security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='d5o_hosted' or (n.nspname='public' and (p.proname like 'd5o%' or p.proname='set_updated_at')) order by 1) x""",
'policy':"""select row_to_json(x)::text from (select schemaname||'.'||tablename||'.'||policyname key,cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') definition from pg_policies where schemaname in ('public','d5o_hosted') order by 1) x"""
}
def snapshot(container):
    out={}
    for kind,sql in queries.items():
        run=subprocess.run(['docker','exec',container,'psql','-U','postgres' if container==clean else 'supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At','-c',sql],capture_output=True,text=True,encoding='utf-8',check=True)
        for line in run.stdout.splitlines():
            row=json.loads(line);out[kind+':'+row['key']]=row
    return out
a=snapshot(clean);b=snapshot(historical)
clean_missing=sorted(set(a)-set(b));historical_extra=sorted(set(b)-set(a))
shared=set(a)&set(b)
different=[]
for key in sorted(shared):
    x=a[key];y=b[key]
    if x!=y:
        fields=sorted(k for k in set(x)|set(y) if x.get(k)!=y.get(k))
        different.append({'key':key,'fields':fields,
            'clean_definition_sha256':hashlib.sha256(str(x.get('definition','')).encode()).hexdigest(),
            'historical_definition_sha256':hashlib.sha256(str(y.get('definition','')).encode()).hexdigest()})
out={'format':'d5o-rc9-effective-catalog-comparison-v1','clean_object_count':len(a),
 'upgraded_object_count':len(b),'shared_count':len(shared),
 'clean_missing_in_upgrade':clean_missing,'historical_extras':historical_extra,
 'different_shared':different,'counts':{'missing':len(clean_missing),'extra':len(historical_extra),'different':len(different)},
 'kind_counts':{'clean':dict(Counter(k.split(':',1)[0] for k in a)),
               'upgraded':dict(Counter(k.split(':',1)[0] for k in b))}}
(EV/'D5O_RC9_EFFECTIVE_CATALOG_COMPARISON.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out['counts']))
