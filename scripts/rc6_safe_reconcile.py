"""Reconcile RC5's sanitized evidence without reading protected production rows."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EV = ROOT / "docs/release/evidence"
SOURCE = ROOT / "supabase/migrations"
read = lambda name: json.loads((EV / name).read_text(encoding="utf-8"))

manifest = read("D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json")
comparison = read("D5O_RC5_LEDGER_COMPARISON.json")
unresolved = read("D5O_RC5_UNRESOLVED_DISCREPANCIES.json")
relations = read("D5O_RC5_PRODUCTION_RELATIONS.json")["rows"]
functions = read("D5O_RC5_PRODUCTION_FUNCTIONS.json")["rows"]
policies = read("D5O_RC5_PRODUCTION_POLICIES.json")["rows"]
ledger = read("D5O_RC5_PRODUCTION_LEDGER.json")["rows"]
assert len(manifest["migrations"]) == 236 and len(ledger) == 177 and unresolved["count"] == 140

for item in manifest["migrations"]:
    actual = hashlib.sha256((SOURCE / item["filename"]).read_bytes()).hexdigest()
    assert actual == item["sha256"], item["filename"]
assert manifest["migrations"][-1]["sha256"] == "6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8"

by_source = {r["source_version"]: r for r in comparison["source_migrations"]}
relation_names = {r["schema"] + "." + r["name"] for r in relations}
function_names = {r["schema"] + "." + r["proname"] for r in functions}
policy_names = {r["schemaname"] + "." + r["tablename"] + "." + r["policyname"] for r in policies}

def catalog_observation(hint):
    match = re.match(r"(create|alter|drop) (schema|table|view|function|procedure|trigger|index|policy|type) ([^\s]+)", hint, re.I)
    if not match:
        return {"hint": hint, "current_catalog": "NOT_ASSESSED"}
    verb, kind, raw = match.groups()
    name = raw.strip('"').lower()
    if kind.lower() in {"table", "view"}:
        key = name if "." in name else "public." + name
        state = "PRESENT" if key in relation_names else "ABSENT"
    elif kind.lower() in {"function", "procedure"}:
        key = name if "." in name else "public." + name
        state = "PRESENT_NAME_ONLY" if key in function_names else "ABSENT_NAME"
    elif kind.lower() == "policy":
        state = "NOT_ASSESSED_WITHOUT_TARGET_RELATION"
    else:
        state = "NOT_ASSESSED"
    return {"hint": hint, "current_catalog": state}

rows = []
for item in unresolved["items"]:
    source = by_source.get(item["id"].split("-", 1)[1]) if item["id"].startswith(("SRC-", "REMAP-")) else None
    hosted_version = item.get("hosted_version")
    if item["id"].startswith("HOST-"):
        finding = "UNKNOWN HISTORICAL EXECUTION"
        disposition = "Retain hosted ledger entry; obtain authorized historical SQL and effect proof."
        risk = "BLOCKING"
    elif item["id"].startswith("REMAP-"):
        finding = "SQL TEXT EQUIVALENT; VERSION MAPPING UNRESOLVED"
        disposition = "Preserve hosted execution; determine safe version-aware forward executor behavior on an authorized copy."
        risk = "BLOCKING"
    elif hosted_version:
        finding = "STORED SQL HASH DIFFERS"
        disposition = "Obtain retained SQL under authorization; compare statement semantics and effective objects before any replay."
        risk = "BLOCKING"
    elif source["order"] <= 44:
        finding = "EARLY SOURCE VERSION ABSENT"
        disposition = "Prove missing effect versus hosted legacy effect; bridge only demonstrated gaps with new forward SQL."
        risk = "BLOCKING"
    else:
        finding = "LATER SOURCE VERSION ABSENT"
        disposition = "Treat as candidate only after historical bridge and preconditions pass."
        risk = "CONDITIONAL"
    rows.append({
        "id": item["id"],
        "source_file": source["source_file"] if source else None,
        "source_version": source["source_version"] if source else None,
        "source_sha256": source["source_sha256"] if source else None,
        "hosted_version": hosted_version,
        "hosted_name": source["hosted_name"] if source else item.get("hosted_name"),
        "hosted_statement_count": source["hosted_statement_count"] if source else next((r["statement_count"] for r in ledger if r["version"] == hosted_version), None),
        "hosted_statements_sha256": source["hosted_statements_sha256"] if source else next((r["statements_sha256"] for r in ledger if r["version"] == hosted_version), None),
        "sql_comparison": "HASH_ONLY; FULL STORED SQL NOT YET COPIED",
        "finding": finding,
        "static_source_effects": [catalog_observation(h) for h in source["source_object_effect_hints"]] if source else [],
        "effective_schema_and_permissions": "UNKNOWN PER MIGRATION; RC5 CATALOG SNAPSHOT ONLY",
        "historical_data_dependency": "UNKNOWN; PROTECTED COPY NOT YET AVAILABLE",
        "risk": risk,
        "disposition": disposition,
        "evidence": [
            "D5O_RC5_LEDGER_COMPARISON.json",
            "D5O_RC5_PRODUCTION_LEDGER.json",
            "D5O_RC5_PRODUCTION_RELATIONS.json",
            "D5O_RC5_PRODUCTION_FUNCTIONS.json",
            "D5O_RC5_PRODUCTION_POLICIES.json",
        ],
    })

out = {
    "format": "d5o-rc6-safe-discrepancy-triage-v1",
    "authorization": "HUMAN_AUTHORIZED; USABLE_DATABASE_CONNECTION_PENDING",
    "source_commit": "a674bf6ba113b31310428bc9ab79564642542bbe",
    "counts": {
        "total": len(rows),
        "hosted_sql_hash_differs": sum(r["finding"] == "STORED SQL HASH DIFFERS" for r in rows),
        "early_source_absent": sum(r["finding"] == "EARLY SOURCE VERSION ABSENT" for r in rows),
        "later_source_absent": sum(r["finding"] == "LATER SOURCE VERSION ABSENT" for r in rows),
        "remap_sql_proved_version_unresolved": sum(r["finding"].startswith("SQL TEXT EQUIVALENT") for r in rows),
        "legacy_hosted_unmatched": sum(r["finding"] == "UNKNOWN HISTORICAL EXECUTION" for r in rows),
    },
    "rows": rows,
}
assert out["counts"] == {
    "total": 140, "hosted_sql_hash_differs": 58, "early_source_absent": 44,
    "later_source_absent": 25, "remap_sql_proved_version_unresolved": 3,
    "legacy_hosted_unmatched": 10,
}, out["counts"]
(EV / "D5O_RC6_SAFE_DISCREPANCY_TRIAGE.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
print(json.dumps(out["counts"]))
