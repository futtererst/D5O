"""Capture sanitized D5O catalog fingerprints from one disposable local database."""
import json
import re
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: rc18_catalog_snapshot.py <container> <output-json>")
container, output_name = sys.argv[1:]
historical_names = {"d5o-rc7-historical-db", "d5o-rc7-recovery-db"}
if not (re.fullmatch(r"supabase_db_d5o-p0a-[a-z0-9-]+", container)
        or container in historical_names):
    raise RuntimeError("unexpected disposable database container")
target = json.loads(subprocess.run(["docker", "inspect", container], check=True,
    capture_output=True, text=True).stdout)[0]
bindings = target["HostConfig"].get("PortBindings") or {}
if container in historical_names:
    if target["HostConfig"]["NetworkMode"] != "none" or bindings:
        raise RuntimeError("historical database is not network isolated")
elif any(binding.get("HostIp") not in ("127.0.0.1", "::1")
         for choices in bindings.values() for binding in (choices or [])):
    raise RuntimeError("clean database port is not loopback-only")
if "fcawktdjoxvahhgvkebx" in json.dumps(target["Config"].get("Env", [])):
    raise RuntimeError("production target marker found")

queries = {
    "function": """select row_to_json(x)::text from (select
      n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' key,
      md5(pg_get_functiondef(p.oid)) definition_md5,md5(p.prosrc) body_md5,
      pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='d5o_hosted' or (n.nspname='public' and p.proname like 'd5o_%')
      order by 1) x""",
    "relation": """select row_to_json(x)::text from (select n.nspname||'.'||c.relname key,
      c.relkind::text kind,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,
      c.relforcerowsecurity force_rls,
      has_table_privilege('anon',c.oid,'SELECT') anon_select,
      has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='d5o_hosted' and c.relkind in ('r','p','v','m') order by 1) x""",
    "policy": """select row_to_json(x)::text from (select schemaname||'.'||tablename||'.'||policyname key,
      cmd,permissive,roles,md5(coalesce(qual,'')) qual_md5,
      md5(coalesce(with_check,'')) check_md5
      from pg_policies where schemaname='d5o_hosted' order by 1) x""",
    "constraint": """select row_to_json(x)::text from (select n.nspname||'.'||c.relname||'.'||q.conname key,
      md5(pg_get_constraintdef(q.oid,true)) definition_md5,q.convalidated validated,
      q.condeferrable deferrable from pg_constraint q join pg_class c on c.oid=q.conrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='d5o_hosted' order by 1) x""",
}
role = "supabase_admin" if container in historical_names else "postgres"
rows = {}
for kind, query in queries.items():
    run = subprocess.run(["docker", "exec", container, "psql", "-U", role, "-d", "postgres",
        "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
        check=True, capture_output=True, text=True, encoding="utf-8")
    rows[kind] = {item["key"]: item for item in map(json.loads, run.stdout.splitlines())}
out = {"format": "d5o-rc18-local-catalog-fingerprints-v1", "kind":
    "historical_upgraded" if container in historical_names else "clean_236",
    "networkMode": target["HostConfig"]["NetworkMode"], "objects": rows}
path = Path(output_name)
if path.is_absolute() or ".." in path.parts or path.suffix != ".json":
    raise RuntimeError("output must be a relative JSON path")
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"kind": out["kind"], "counts": {k: len(v) for k, v in rows.items()},
    "output": str(path)}))
