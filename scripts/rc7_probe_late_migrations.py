"""Transactionally probe frozen source orders 212-236 in offline restored DB."""
import json, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "docs/release/evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json").read_text())["migrations"]
selected = manifest[211:]
assert len(selected) == 25 and selected[-1]["order"] == 236
target = json.loads(subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"], capture_output=True, text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none" and not target["HostConfig"].get("PortBindings")
parts = ["begin;"]
for item in selected:
    sql = (ROOT / "supabase/migrations" / item["filename"]).read_text(encoding="utf-8")
    if re.search(r"(?im)^\s*(begin|commit|rollback)\s*;", sql): raise RuntimeError("embedded transaction")
    parts.extend([f"select 'RC7_ORDER_{item['order']}' as marker;", sql])
parts.append("rollback;")
run = subprocess.run(["docker", "exec", "-i", "d5o-rc7-historical-db", "psql", "-U", "supabase_admin",
    "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At"], input="\n".join(parts),
    capture_output=True, text=True)
markers = [int(x) for x in re.findall(r"RC7_ORDER_(\d+)", run.stdout)]
last = markers[-1] if markers else None
diagnostic = next((s for s in run.stderr.splitlines() if "ERROR:" in s), "unknown local SQL failure") if run.returncode else None
results = [{"order": item["order"], "filename": item["filename"],
    "result": "PASSED_ROLLED_BACK" if not run.returncode or item["order"] < last else
              "FAILED_ROLLED_BACK" if item["order"] == last else "NOT_REACHED",
    **({"diagnostic": re.sub(r"'[^']*'", "'[redacted]'", diagnostic)[:250]} if item["order"] == last and run.returncode else {})}
    for item in selected]
out = {"format": "d5o-rc7-late-migration-probe-v1", "scope": "isolated historical copy; cumulative transaction rolled back",
    "warning": "A transaction probe does not establish ledger reconciliation, post-commit behavior or recovery.",
    "results": results}
(ROOT / "docs/release/evidence/D5O_RC7_LATE_MIGRATION_PROBE.json").write_text(json.dumps(out, indent=2)+"\n")
print(json.dumps({"probed": len(results), "last": results[-1]}))
