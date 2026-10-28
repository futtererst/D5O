"""Compare final isolated D5O function privileges with real production start."""
import json
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
source=json.loads((root/"docs/release/evidence/D5O_RC10_PRODUCTION_FUNCTION_ACL.json").read_text())
target=json.loads(subprocess.run(["docker","inspect","d5o-rc7-historical-db"],capture_output=True,text=True,check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"]=="none" and not target["HostConfig"].get("PortBindings")
sql="select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE'),pg_get_userbyid(p.proowner),p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'd5o%' order by 1"
run=subprocess.run(["docker","exec","d5o-rc7-historical-db","psql","-U","supabase_admin","-d","postgres","-At","-c",sql],capture_output=True,text=True,encoding="utf-8",check=True)
actual={}
for line in run.stdout.splitlines():
    sig,anon,auth,service,owner,secdef=line.split("|")
    actual[sig]={"anon":anon=="t","authenticated":auth=="t","service":service=="t","owner":owner,"security_definer":secdef=="t"}
prior={row["signature"]:row for row in source["rows"]}
missing=sorted(set(prior)-set(actual))
changed=[]
for signature,row in prior.items():
    if signature not in actual:continue
    found=actual[signature]
    difference=[field for field,value in (("anon",row["anon_execute"]),("authenticated",row["authenticated_execute"]),("service",row["service_execute"]),("owner",row["owner"]),("security_definer",row["security_definer"])) if found[field]!=value]
    if difference:changed.append({"signature":signature,"fields":difference})
new=sorted(set(actual)-set(prior))
out={"format":"d5o-rc10-final-d5o-acl-v1","network_mode":"none","starting_functions":len(prior),"final_functions":len(actual),"new_functions":len(new),"missing_prior_functions":missing,"changed_prior_functions":changed,"anonymous_executable_final":[sig for sig,row in actual.items() if row["anon"]],"new_function_signatures":new,"final_authenticated_execute_count":sum(row["authenticated"] for row in actual.values()),"final_service_execute_count":sum(row["service"] for row in actual.values())}
(root/"docs/release/evidence/D5O_RC10_FINAL_D5O_ACL.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps({"prior_changed":len(changed),"new":len(new),"anon_final":len(out["anonymous_executable_final"]),"missing_prior":len(missing)}))
