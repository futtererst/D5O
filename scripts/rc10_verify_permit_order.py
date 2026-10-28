"""Rollback-free synthetic permit-order expression against isolated upgraded PG."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = json.loads(subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"],
                                   capture_output=True, text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none"
assert not target["HostConfig"].get("PortBindings")
sql = """
with synthetic(payload) as (values ('[
 {"id":"older-held","createdAt":"2026-10-27T12:00:00Z"},
 {"id":"newest-appended","createdAt":"2026-10-27T12:00:00Z"}
]'::jsonb))
select value->>'id' from synthetic,
  lateral jsonb_array_elements(payload) with ordinality as p(value, ordinal)
order by ordinal desc limit 1;
"""
run = subprocess.run(["docker", "exec", "d5o-rc7-historical-db", "psql", "-U", "postgres",
                      "-d", "postgres", "-At", "-c", sql], capture_output=True,
                     text=True, check=True)
selected = run.stdout.strip()
source = (root / "supabase/migrations/20261027190000_d5o_field_fact_latest_permit_order.sql").read_text()
assert selected == "newest-appended"
assert "with ordinality" in source.lower() and "order by ordinal desc" in source.lower()
out = {"format": "d5o-rc10-permit-order-v1", "network_mode": "none",
       "synthetic_tied_timestamps": True, "selected": selected,
       "source_uses_append_ordinality": True,
       "historical_permit_rows_modified": False,
       "limit": "Selector expression verified; full authenticated field-fact command was not executed."}
(root / "docs/release/evidence/D5O_RC10_PERMIT_ORDER.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out))
