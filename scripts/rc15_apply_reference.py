"""Apply actual frozen late migrations to a network-isolated historical copy.

The bridge pre/source/post trio at order 215 is one transaction. Ledger rows
are inserted only after the corresponding SQL has executed, in that same
transaction, with the exact executed SQL retained in statements[].
"""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EV=ROOT/'docs/release/evidence'
manifest=json.loads((EV/'D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations']
selected=manifest[211:]
assert len(selected)==25 and selected[0]['order']==212 and selected[-1]['order']==236
target=json.loads(subprocess.run(['docker','inspect','d5o-rc7-recovery-db'],capture_output=True,text=True,check=True).stdout)[0]
assert target['HostConfig']['NetworkMode']=='none' and not target['HostConfig'].get('PortBindings')
local_role=os.environ.get('D5O_RC10_LOCAL_DB_ROLE','supabase_admin')
if local_role not in ('supabase_admin','postgres'): raise RuntimeError('unexpected isolated database role')
psql=['docker','exec','-i','d5o-rc7-recovery-db','psql','-U',local_role,'-d','postgres','-q','-X','-v','ON_ERROR_STOP=1','-At']
def query(sql):
    r=subprocess.run(psql+['-c',sql],capture_output=True,text=True,encoding='utf-8',check=True)
    return r.stdout.strip()
def table_counts():
    names=query("select quote_ident(n.nspname)||'.'||quote_ident(c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','d5o_hosted','storage','supabase_migrations') order by 1").splitlines()
    sql=' union all '.join("select '"+name+"' as table_name,count(*) as n from "+name for name in names)
    return dict(line.rsplit('|',1) for line in query(sql).splitlines())
def stable_hashes():
    specifications={
      'auth_users':("auth.users","to_jsonb(t) - 'encrypted_password' - 'confirmation_token' - 'recovery_token'"),
      'auth_identities':("auth.identities","to_jsonb(t) - 'identity_data'"),
      'memberships':("d5o_hosted.memberships","jsonb_build_array(workspace_id,actor_user_id,role,status)"),
      'invitation_history':("d5o_hosted.admin_identity_requests","jsonb_build_array(workspace_id,command_id,actor_user_id,action,target_email,reason,fingerprint,status,provider_user_id,created_at,resolved_at,requested_role,setup_completed_at)"),
      'work_records':("d5o_hosted.work_records","jsonb_build_array(id,workspace_id,configuration_version_id,work_type_key)"),
      'work_events':("d5o_hosted.work_events","to_jsonb(t)"),
      'configuration_versions':("d5o_hosted.configuration_versions","to_jsonb(t)-'source_template_version_id'"),
      'customer_evidence':("d5o_hosted.customer_decision_evidence","to_jsonb(t)"),
      'public_audit':("public.audit_events","to_jsonb(t)"),
      'storage_metadata':("storage.objects","to_jsonb(t)"),
    }
    parts=["select '"+label+"' as label,md5(coalesce(string_agg(md5(("+expr+")::text),'|' order by md5(("+expr+")::text)),'')) from "+table+" t" for label,(table,expr) in specifications.items()]
    return dict(line.split('|',1) for line in query(' union all '.join(parts)).splitlines())
start=query("select count(*)||'|'||max(version) from supabase_migrations.schema_migrations")
if start!='177|20261021123923': raise RuntimeError('starting historical ledger mismatch')
fingerprint_file=EV/'D5O_RC9_START_FINGERPRINT.json'
if fingerprint_file.exists():
    expected=json.loads(fingerprint_file.read_text())
    probes={
      'ledger':"select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version) t",
      'workspaces':"select id::text from d5o_hosted.workspaces order by id",
      'auth_users':"select id::text from auth.users order by id",
      'storage_associations':"select id::text||'|'||bucket_id||'|'||name from storage.objects order by id",
      'legacy_invitation':"select workspace_id::text||'|'||command_id||'|'||requested_role||'|'||status||'|'||fingerprint from d5o_hosted.admin_identity_requests where action='invite' and requested_role='field_worker' and status='setup_completed'"
    }
    for name,sql in probes.items():
        if hashlib.sha256(query(sql).encode()).hexdigest()!=expected['fingerprints_sha256'][name]:
            raise RuntimeError('approved historical start fingerprint mismatch: '+name)
probe='--probe' in sys.argv
before_counts=table_counts() if not probe else None
before_hashes=stable_hashes() if not probe else None
def encoded(value):
    return "convert_from(decode('"+value.encode().hex()+"','hex'),'UTF8')"
def batch(item):
    source=(ROOT/'supabase/migrations'/item['filename']).read_bytes()
    if hashlib.sha256(source).hexdigest()!=item['sha256']: raise RuntimeError('frozen source hash mismatch')
    source=source.decode('utf-8')
    parts=[source]
    if item['order']==215:
        pre=(ROOT/'scripts/rc8_bridge_pre_215.sql').read_text()
        post=(ROOT/'scripts/rc8_bridge_post_215.sql').read_text()
        parts=[pre,source,post]
    return parts
results=[]
if probe:
    # Cumulative SQL execution without ledger insertion; rollback on success
    # or connection-close on error. No part of the probe persists.
    script=['begin;','set local lock_timeout=\'5s\';']
    for item in selected:
        script.append(f"select 'RC8_ORDER_{item['order']}';")
        script.extend(batch(item))
    script.append('rollback;')
    run=subprocess.run(psql,input='\n'.join(script),capture_output=True,text=True,encoding='utf-8')
    markers=[int(x) for x in re.findall('RC8_ORDER_(\\d+)',run.stdout)]
    last=markers[-1] if markers else None
    diagnostic=next((line for line in run.stderr.splitlines() if 'ERROR:' in line),'unknown SQL failure') if run.returncode else None
    for item in selected:
        order=item['order']
        state=('PASSED_ROLLED_BACK' if not run.returncode or order<last else
               'FAILED_ROLLED_BACK' if order==last else 'NOT_REACHED')
        row={'order':order,'filename':item['filename'],'result':state}
        if state=='FAILED_ROLLED_BACK': row['diagnostic']=re.sub(r"'[^']*'","'[redacted]'",diagnostic)[:250]
        results.append(row)
else:
    for item in selected:
        parts=batch(item)
        statement_array='array['+','.join(encoded(x) for x in parts)+']::text[]'
        name=item['filename'].split('_',1)[1].removesuffix('.sql')
        sql='\n'.join(['begin;','set local lock_timeout=\'5s\';',*parts,
          "insert into supabase_migrations.schema_migrations(version,statements,name) values ("
          +encoded(item['version'])+','+statement_array+','+encoded(name)+');','commit;'])
        run=subprocess.run(psql,input=sql,capture_output=True,text=True,encoding='utf-8')
        if run.returncode:
            diagnostic=next((line for line in run.stderr.splitlines() if 'ERROR:' in line),'unknown SQL failure')
            results.append({'order':item['order'],'filename':item['filename'],'result':'FAILED_ROLLED_BACK',
              'diagnostic':re.sub(r"'[^']*'","'[redacted]'",diagnostic)[:250]})
            break
        actual=query("select cardinality(statements) from supabase_migrations.schema_migrations where version='"+item['version']+"'")
        if actual!=str(len(parts)): raise RuntimeError('actual migration ledger recording failed')
        results.append({'order':item['order'],'filename':item['filename'],'result':'APPLIED_AND_RECORDED',
          'ledger_statement_count':len(parts)})
out={'format':'d5o-rc8-ordered-upgrade-v1','mode':'cumulative_probe_rollback' if probe else 'actual_isolated_apply',
 'starting_ledger':'177|20261021123923','results':results,'all_25_succeeded':len(results)==25 and all(r['result'] in ('PASSED_ROLLED_BACK','APPLIED_AND_RECORDED') for r in results)}
if not probe: out['ending_ledger']=query("select count(*)||'|'||max(version) from supabase_migrations.schema_migrations")
if not probe:
    after_counts=table_counts(); after_hashes=stable_hashes()
    out['historical_table_count_changes']={name:{'before':count,'after':after_counts.get(name)}
      for name,count in before_counts.items() if name!='supabase_migrations.schema_migrations' and after_counts.get(name)!=count}
    out['stable_historical_hash_matches']={name:before_hashes[name]==after_hashes[name] for name in before_hashes}
    out['starting_table_count']=len(before_counts);out['ending_table_count']=len(after_counts)
path=EV/('D5O_RC15_REFERENCE_PROBE.json' if probe else 'D5O_RC15_REFERENCE_UPGRADE.json')
path.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'mode':out['mode'],'last':results[-1],'all25':out['all_25_succeeded'],
  'endingLedger':out.get('ending_ledger')}))
