"""Build a conservative, sanitized 73-item RC9 history disposition matrix."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ev = root / "docs/release/evidence"
prior = json.loads((ev / "D5O_RC8_DISCREPANCY_DISPOSITIONS.json").read_text())
effects = json.loads((ev / "D5O_RC9_HISTORICAL_OBJECT_EFFECTS.json").read_text())
relations = json.loads((ev / "D5O_RC5_PRODUCTION_RELATIONS.json").read_text())["rows"]
catalog = json.loads((ev / "D5O_RC9_EFFECTIVE_CATALOG_COMPARISON.json").read_text())
clean_missing = set(catalog["clean_missing_in_upgrade"])
historical_extra = set(catalog["historical_extras"])
shared_different = {x["key"]: x["fields"] for x in catalog["different_shared"]}
actual_tables = {r["schema"] + "." + r["name"] for r in relations if r["relkind"] in ("r", "p")}
source_effects = {r["source_file"]: r for r in effects["early_source"]}
legacy_effects = {r["hosted_version"]: r for r in effects["legacy_hosted"]}
app_tables = {"public.config_tenants", "public.config_tenant_configurations",
              "public.config_configuration_versions", "public.evidence_objects",
              "public.opportunity_bid_submission_events",
              "public.opportunity_bid_evidence_satisfactions"}
matrix = []
for old in prior["items"]:
    status = old["status"]
    if status not in ("HISTORICAL_EFFECT_UNPROVEN",
                      "SQL_EQUIVALENT_VERSION_MAPPING_UNRESOLVED",
                      "LEGACY_HOSTED_EFFECT_UNPROVEN"):
        continue
    item = {"id": old["id"], "source_file": old.get("source_file"),
            "source_version": old.get("source_version"),
            "hosted_version": old.get("hosted_version"),
            "classification": "UNRESOLVED RELEASE BLOCKER"}
    if status == "SQL_EQUIVALENT_VERSION_MAPPING_UNRESOLVED":
        item.update(classification="PROVEN EQUIVALENT",
                    evidence="RC8 retained-SQL byte/UTF8-token equivalence; actual hosted ledger remains authoritative",
                    disposition="Keep hosted version and SQL; do not replay source or insert source-version ledger row. Verify final object/permission effects separately.",
                    historical_execution_proven=False)
    elif status == "HISTORICAL_EFFECT_UNPROVEN":
        e = source_effects[old["source_file"]]
        tables = sorted({x["object"] for x in e["effects"] if x["kind"] == "TABLE" and x["verb"] == "CREATE"})
        missing = sorted(set(tables) - actual_tables)
        app_missing = sorted(set(missing) & app_tables)
        item.update(source_sha256=e["source_sha256"],
                    static_object_effects=e["effects"],
                    source_created_tables_missing_at_rc5_inventory=missing,
                    frozen_app_referenced_missing_tables=app_missing,
                    evidence="RC5 bounded production relation catalog; static source CREATE/ALTER/DROP extraction; RC8 25-file execution",
                    disposition="No historical execution proof. Compare exact upgraded object definitions, owners, grants, RLS and application paths before production. Never replay by absent version alone.",
                    historical_execution_proven=False)
        object_keys = sorted({("relation" if x["kind"] == "TABLE" else x["kind"].lower()) + ":" + x["object"] for x in e["effects"]
                              if x["kind"] in ("TABLE", "FUNCTION", "INDEX", "TRIGGER", "POLICY")})
        item["final_catalog_effects"] = {
            "missing_from_upgraded": [k for k in object_keys if k in clean_missing],
            "present_but_definition_differs": [k for k in object_keys if k in shared_different],
            "present_in_both_by_name": [k for k in object_keys
                                        if k not in clean_missing and k not in historical_extra and k not in shared_different],
        }
        item["evidence"] += "; RC9 clean-236 versus historical-202 catalog diff"
        item["final_catalog_created_tables_missing"] = sorted(
            t for t in tables if "relation:" + t in clean_missing)
        if app_missing:
            item["risk"] = "Frozen application references source-created table absent from RC5 production catalog; later source files do not CREATE it. Final upgraded catalog check required."
    else:
        e = legacy_effects[old["hosted_version"]]
        item.update(hosted_name=e["hosted_name"],
                    hosted_retained_sql_sha256=e["retained_sql_sha256"],
                    hosted_statement_count=e["statement_count"],
                    static_object_effects=e["effects"],
                    evidence="Actual 177-entry historical ledger retained SQL; static object extraction; RC5 production catalog",
                    disposition="Preserve actual hosted ledger. Confirm intended legacy effects and final dependencies; do not invent source counterpart.",
                    historical_execution_proven=True)
        object_keys = sorted({("relation" if x["kind"] == "TABLE" else x["kind"].lower()) + ":" + x["object"] for x in e["effects"]
                              if x["kind"] in ("TABLE", "FUNCTION", "INDEX", "TRIGGER", "POLICY")})
        item["final_catalog_effects"] = {
            "legacy_only_by_name": [k for k in object_keys if k in historical_extra],
            "shared_but_definition_differs": [k for k in object_keys if k in shared_different],
            "missing_from_upgraded": [k for k in object_keys if k in clean_missing],
        }
        item["evidence"] += "; RC9 clean-236 versus historical-202 catalog diff"
    matrix.append(item)
assert len(matrix) == 73
counts = {c: sum(x["classification"] == c for x in matrix) for c in
          ("PROVEN EQUIVALENT", "PROVEN EFFECT PRESENT", "VALID LEGACY-ONLY EFFECT",
           "REVIEWED FORWARD CORRECTION REQUIRED", "NOT APPLICABLE WITH EVIDENCE",
           "UNRESOLVED RELEASE BLOCKER")}
out = {"format": "d5o-rc9-historical-dispositions-v1", "count": len(matrix),
       "counts": counts,
       "caution": "Text equivalence of remapped SQL does not prove its historical application under the source version; early effects and legacy object behavior need final effective-catalog checks.",
       "items": matrix}
(ev / "D5O_RC9_HISTORICAL_DISPOSITIONS.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(counts))
