"""Inject local failures after each order-215 bridge phase and prove rollback."""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EV=ROOT/'docs/release/evidence'
manifest=json.loads((EV/'D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations']
items=manifest[211:215]
assert [x['order'] for x in items]==[212,213,214,215]
target=json.loads(subprocess.run(['docker','inspect','d5o-rc7-historical-db'],capture_output=True,text=True,check=True).stdout)[0]
assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
psql=['docker','exec','-i','d5o-rc7-historical-db','psql','-U','supabase_admin','-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At']
def query(sql):return subprocess.run(psql+['-c',sql],capture_output=True,text=True,check=True).stdout.strip()
def check_baseline():
    sql="select (select count(*) from supabase_migrations.schema_migrations),to_regclass('d5o_hosted.tenant_provisioning') is null,to_regclass('d5o_hosted.rc8_invitation_bridge_receipts') is null,(select count(*) from d5o_hosted.admin_identity_requests where requested_role='field_worker' and status='setup_completed')"
    return query(sql)=='177|t|t|1'
if not check_baseline():raise RuntimeError('unexpected starting state')
def source(item):
    body=(ROOT/'supabase/migrations'/item['filename']).read_bytes()
    if hashlib.sha256(body).hexdigest()!=item['sha256']:raise RuntimeError('source hash drift')
    return body.decode('utf-8')
prefix=[source(x) for x in items[:3]]
pre=(ROOT/'scripts/rc8_bridge_pre_215.sql').read_text()
middle=source(items[3])
post=(ROOT/'scripts/rc8_bridge_post_215.sql').read_text()
def encoded(x):return "convert_from(decode('"+x.encode().hex()+"','hex'),'UTF8')"
ledger="insert into supabase_migrations.schema_migrations(version,statements,name) values ("+encoded(items[3]['version'])+',array['+','.join(encoded(x) for x in (pre,middle,post))+']::text[],'+encoded(items[3]['filename'].split('_',1)[1].removesuffix('.sql'))+');'
phases=[('after_pre',[pre]),('after_frozen_215',[pre,middle]),('after_post',[pre,middle,post]),('after_ledger_insert',[pre,middle,post,ledger])]
out=[]
for label,parts in phases:
    script='\n'.join(['begin;',*prefix,*parts,"do $rc9$ begin raise exception 'rc9_injected_failure' using errcode='P0001'; end $rc9$;",'rollback;'])
    run=subprocess.run(psql,input=script,capture_output=True,text=True,encoding='utf-8')
    injected=run.returncode!=0 and 'rc9_injected_failure' in run.stderr
    baseline=check_baseline()
    if not injected or not baseline:raise RuntimeError('atomicity probe failed at '+label)
    out.append({'phase':label,'injected_error_sqlstate':'P0001','full_transaction_rolled_back':baseline,
      'historical_invitation_restored':True,'bridge_receipt_absent':True,'ledger_rows':177})
result={'format':'d5o-rc9-bridge-atomicity-v1','probes':out,'all_passed':len(out)==4}
(EV/'D5O_RC9_BRIDGE_ATOMICITY.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'allPassed':result['all_passed'],'probes':len(out)}))
