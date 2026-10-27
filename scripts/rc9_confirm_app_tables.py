"""Confirm frozen app relations in isolated historical-upgrade database."""
import json, subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
container = "d5o-rc7-recovery-db"
target = json.loads(subprocess.run(["docker", "inspect", container], capture_output=True,
                                   text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none"
assert not target["HostConfig"].get("PortBindings")
names = ["config_tenants", "config_tenant_configurations", "config_configuration_versions",
         "evidence_objects", "opportunity_bid_submission_events",
         "opportunity_bid_evidence_satisfactions"]
sql = "select n, to_regclass('public.'||n) is not null from (values " + ",".join(
    "('" + n + "')" for n in names) + ") v(n) order by n"
run = subprocess.run(["docker", "exec", container, "psql", "-U", "supabase_admin",
                      "-d", "postgres", "-At", "-c", sql], capture_output=True,
                     text=True, encoding="utf-8", check=True)
results = {line.split("|")[0]: line.split("|")[1] == "t" for line in run.stdout.splitlines()}
ledger = subprocess.run(["docker", "exec", container, "psql", "-U", "supabase_admin",
                         "-d", "postgres", "-At", "-c",
                         "select count(*) from supabase_migrations.schema_migrations"],
                        capture_output=True, text=True, encoding="utf-8", check=True).stdout.strip()
assert ledger == "202" and len(results) == 6
out = {"format": "d5o-rc9-final-app-table-check-v1", "network_mode": "none",
       "actual_ledger_rows": int(ledger), "tables_present": results,
       "all_required_present": all(results.values())}
(root / "docs/release/evidence/D5O_RC9_FINAL_APP_TABLE_CHECK.json").write_text(
    json.dumps(out, indent=2) + "\n")
print(json.dumps({"ledger": ledger, "missing": [n for n, ok in results.items() if not ok]}))
