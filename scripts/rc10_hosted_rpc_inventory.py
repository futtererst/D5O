"""Check frozen hosted API literal RPC names against isolated upgraded catalog."""
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
files = []
for directory in ("app/api/d5o-hosted", "lib/d5o/hosted", "app/work", "app/platform-admin"):
    path = root / directory
    files.extend(p for p in path.rglob("*") if p.suffix in (".ts", ".tsx") and "-ShawnT13" not in p.name)
pattern = re.compile(r"\b(?:rpc|call)\s*\(\s*['\"]([a-z][a-z0-9_]+)['\"]", re.I)
calls = {}
for path in files:
    for name in pattern.findall(path.read_text(encoding="utf-8", errors="ignore")):
        calls.setdefault(name, []).append(path.relative_to(root).as_posix())
inspect = json.loads(subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"],
                                    capture_output=True, text=True, check=True).stdout)[0]
assert inspect["HostConfig"]["NetworkMode"] == "none" and not inspect["HostConfig"].get("PortBindings")
sql = "select n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','d5o_hosted') order by 1"
run = subprocess.run(["docker", "exec", "d5o-rc7-historical-db", "psql", "-U", "supabase_admin",
                      "-d", "postgres", "-At", "-c", sql], capture_output=True, text=True,
                     encoding="utf-8", check=True)
found = {line.split(".", 1)[1] for line in run.stdout.splitlines()}
out = {"format": "d5o-rc10-hosted-rpc-inventory-v1", "isolated": True,
       "literal_rpc_call_count": len(calls),
       "missing_literal_rpc_names": sorted(set(calls) - found),
       "calls": [{"name": name, "present": name in found, "sources": sorted(set(paths))}
                 for name, paths in sorted(calls.items())],
       "limitation": "Literal calls only; dynamic RPC names and function behavior require separate qualification."}
(root / "docs/release/evidence/D5O_RC10_HOSTED_RPC_INVENTORY.json").write_text(
    json.dumps(out, indent=2) + "\n")
print(json.dumps({"literal_rpc_calls": len(calls), "missing": out["missing_literal_rpc_names"]}))
