"""Repair only isolated restore D5O function ACLs from read-only production catalog.

This is a restore-fidelity operation, not a hosted migration or source change.
"""
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = json.loads((root / "docs/release/evidence/D5O_RC10_PRODUCTION_FUNCTION_ACL.json").read_text())
rows = source["rows"]
assert source["project"] == "fcawktdjoxvahhgvkebx" and len(rows) == 165
assert len({r["signature"] for r in rows}) == 165
assert all(re.fullmatch(r"public\.[a-z0-9_]+\([a-z0-9_,. \[\]]*\)", r["signature"]) for r in rows)
assert all(r["owner"] == "postgres" and not r["anon_execute"] for r in rows)

container = "d5o-rc7-historical-db"
target = json.loads(subprocess.run(["docker", "inspect", container], capture_output=True,
                                   text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none" and not target["HostConfig"].get("PortBindings")
psql = ["docker", "exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres",
        "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At"]

def query(sql):
    return subprocess.run(psql + ["-c", sql], capture_output=True, text=True,
                          encoding="utf-8", check=True).stdout.strip()

assert query("select count(*) from supabase_migrations.schema_migrations") == "177"
catalog_sql = "select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'd5o%' order by 1"
assert set(query(catalog_sql).splitlines()) == {r["signature"] for r in rows}
commands = ["begin;", "set local lock_timeout='5s';"]
for row in rows:
    signature = row["signature"]
    commands.append(f"revoke all on function {signature} from public, anon, authenticated, service_role;")
    for role, field in (("authenticated", "authenticated_execute"), ("service_role", "service_execute")):
        if row[field]:
            commands.append(f"grant execute on function {signature} to {role};")
commands.append("commit;")
run = subprocess.run(psql, input="\n".join(commands), capture_output=True,
                     text=True, encoding="utf-8")
if run.returncode:
    raise RuntimeError("isolated ACL repair failed: " + next(
        (line for line in run.stderr.splitlines() if "ERROR:" in line), "unknown"))

after_sql = "select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE'),pg_get_userbyid(p.proowner),p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'd5o%' order by 1"
actual = {}
for line in query(after_sql).splitlines():
    sig, anon, auth, service, owner, secdef = line.split("|")
    actual[sig] = (anon == "t", auth == "t", service == "t", owner, secdef == "t")
matches = all(actual[r["signature"]] == (r["anon_execute"], r["authenticated_execute"],
                                        r["service_execute"], r["owner"], r["security_definer"])
              for r in rows)
if not matches or query("select count(*) from supabase_migrations.schema_migrations") != "177":
    raise RuntimeError("isolated ACL postcondition mismatch")
out = {"format": "d5o-rc10-local-restore-acl-reconciliation-v1",
       "network_mode": "none", "target_ledger_rows": 177, "functions_reconciled": len(rows),
       "anon_execute_count": sum(r["anon_execute"] for r in rows),
       "authenticated_execute_count": sum(r["authenticated_execute"] for r in rows),
       "service_execute_count": sum(r["service_execute"] for r in rows),
       "owner_and_security_definer_match": True, "ledger_unchanged": True,
       "production_modified": False, "scope": "isolated restore fidelity only"}
(root / "docs/release/evidence/D5O_RC10_LOCAL_ACL_RECONCILIATION.json").write_text(
    json.dumps(out, indent=2) + "\n")
print(json.dumps(out))
