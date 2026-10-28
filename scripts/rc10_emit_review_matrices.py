"""Emit sanitized, source-derived RC10 scope and ordered bridge matrices."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
evidence = root / "docs/release/evidence"
manifest = json.loads((evidence / "D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json").read_text())["migrations"]
assert len(manifest) == 236
for row in manifest:
    assert hashlib.sha256((root / "supabase/migrations" / row["filename"]).read_bytes()).hexdigest() == row["sha256"]
scope = json.loads((evidence / "D5O_RC10_SCOPE_TRIAGE.json").read_text())
origins = {
    "config_tenants": ("0017_configuration_foundation_core.sql", ["organizations", "workspaces", "auth.users"]),
    "config_tenant_configurations": ("0019_configuration_tenant_activation_versions.sql", ["config_tenants", "config_tenant_template_activations", "auth.users"]),
    "config_configuration_versions": ("0019_configuration_tenant_activation_versions.sql", ["config_tenant_configurations", "config_template_pack_versions", "auth.users"]),
    "evidence_objects": ("0006_shared_command_audit_evidence.sql", ["workspaces", "projects", "auth.users", "public.set_updated_at", "storage.objects"]),
    "opportunity_bid_submission_events": ("0016_p1_01b_2_bid_submission_outcome.sql", ["workspaces", "opportunities", "auth.users"]),
    "opportunity_bid_evidence_satisfactions": ("0030_cfg_runtime_03_evidence_persistence_authority.sql", ["workspaces", "opportunities", "evidence_links", "evidence_objects", "config_configuration_versions", "config_template_pack_versions", "config_gate_evidence_requirements", "config_evidence_type_definitions", "auth.users", "user_profiles", "audit_events"]),
}
by_relation = {row["relation"].removeprefix("public."): row for row in scope["missing_public_relations"]}
matrix = []
for table, (file, deps) in origins.items():
    row = by_relation[table]
    matrix.append({"relation": "public." + table, "source_migration": file,
                   "source_sha256": next(x["sha256"] for x in manifest if x["filename"] == file),
                   "declared_dependencies": deps,
                   "frozen_app_literal_references": row["application_source_references"],
                   "hosted_d5o_function_references": row["hosted_function_name_references"],
                   "hosted_runtime_disposition": row["classification"],
                   "basis": row["basis"],
                   "historical_execution_proven": False,
                   "full_legacy_dependency_closure_qualified": False})
(evidence / "D5O_RC10_OBJECT_DEPENDENCY_MATRIX.json").write_text(json.dumps({
    "format": "d5o-rc10-object-dependency-matrix-v1",
    "conditional_runtime": scope["conditional_runtime"], "rows": matrix,
    "limit": "Declared direct dependencies and literal references; no legacy-path migration is proposed."
}, indent=2) + "\n")
prior = json.loads((evidence / "D5O_RC10_ORDERED_UPGRADE.json").read_text())
assert prior["all_25_succeeded"] and len(prior["results"]) == 25
bridge = []
for name in ("rc8_bridge_pre_215.sql", "rc8_bridge_post_215.sql"):
    bridge.append({"file": "scripts/" + name,
                   "sha256": hashlib.sha256((root / "scripts" / name).read_bytes()).hexdigest()})
sequence = []
for row in prior["results"]:
    source = next(x for x in manifest if x["filename"] == row["filename"])
    sequence.append({"order": row["order"], "source_file": row["filename"],
                     "source_sha256": source["sha256"],
                     "ledger_statement_count": row["ledger_statement_count"],
                     "bridge_transaction": row["order"] == 215})
(evidence / "D5O_RC10_EXACT_SEQUENCE.json").write_text(json.dumps({
    "format": "d5o-rc10-exact-sequence-v1", "starting_ledger_rows": 177,
    "ending_ledger_rows": 202, "local_restore_acl_reconciliation": "before migration only; not production SQL",
    "forward_compatibility_sql": [], "bridge_files": bridge, "ordered_source_migrations": sequence,
    "ledger_contract": "Actual SQL recorded by RC8 runner; no fabricated historical rows."
}, indent=2) + "\n")
print(json.dumps({"manifest": len(manifest), "matrix": len(matrix), "sequence": len(sequence)}))
