"""Bounded RC10 hosted-runtime dependency triage; no business rows are read."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EV = ROOT / "docs/release/evidence"
comparison = json.loads((EV / "D5O_RC9_EFFECTIVE_CATALOG_COMPARISON.json").read_text())
missing_relations = sorted(x.removeprefix("relation:public.") for x in comparison["clean_missing_in_upgrade"]
                           if x.startswith("relation:public."))
missing_policies = sorted(x.removeprefix("policy:public.") for x in comparison["clean_missing_in_upgrade"]
                          if x.startswith("policy:public."))
assert len(missing_relations) == 72 and len(missing_policies) == 212
legacy_route_evidence = {
    "config_configuration_versions": "Public configuration client is behind the exact local proof-environment guard; hosted Work uses d5o_hosted_configuration_inventory_v1.",
    "config_tenant_configurations": "Public configuration client is behind the exact local proof-environment guard; hosted Work uses d5o_hosted_configuration_inventory_v1.",
    "config_tenants": "Public configuration client is behind the exact local proof-environment guard; hosted Work uses d5o_hosted_configuration_inventory_v1.",
    "evidence_objects": "Legacy evidence/closeout/field routes return 503 from the hosted production proxy; hosted evidence uses d5o_hosted RPCs.",
    "opportunity_bid_submission_events": "Pipeline routes return 503 from the hosted production proxy; repository database access also rejects production runtime.",
}

target = json.loads(subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"],
                                   capture_output=True, text=True, check=True).stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none" and not target["HostConfig"].get("PortBindings")
sql = "select row_to_json(x)::text from (select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='d5o_hosted' or (n.nspname='public' and p.proname like 'd5o%')) x"
run = subprocess.run(["docker", "exec", "d5o-rc7-historical-db", "psql", "-U", "supabase_admin",
                      "-d", "postgres", "-At", "-c", sql], capture_output=True, text=True,
                     encoding="utf-8", check=True)
hosted_functions = [json.loads(line) for line in run.stdout.splitlines()]
app_files = [p for base in (ROOT / "app", ROOT / "lib", ROOT / "components")
             for p in base.rglob("*") if p.suffix in (".ts", ".tsx") and "-ShawnT13" not in p.name]
app_text = {p.relative_to(ROOT).as_posix(): p.read_text(encoding="utf-8", errors="ignore") for p in app_files}

relations = []
for name in missing_relations:
    word = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(name) + r"(?![A-Za-z0-9_])", re.I)
    hits = sorted(path for path, text in app_text.items() if word.search(text))
    function_hits = sorted({f["proname"] for f in hosted_functions if word.search(f["definition"])})
    if function_hits:
        classification = "UNRESOLVED"
        basis = "A hosted D5O function definition references this absent relation."
    elif hits:
        classification = "OPTIONAL / INAPPLICABLE" if name in legacy_route_evidence else "UNRESOLVED"
        basis = legacy_route_evidence.get(name, "Source reference requires runtime-branch review.")
    else:
        classification = "OPTIONAL / INAPPLICABLE"
        basis = "No literal relation reference in frozen app or hosted D5O function definitions."
    relations.append({"relation": "public." + name, "application_source_references": hits,
                      "hosted_function_name_references": function_hits,
                      "classification": classification, "basis": basis})

policy_rows = []
for item in missing_policies:
    table = item.split(".", 1)[0]
    relation = "public." + table
    absent = table in missing_relations
    policy_rows.append({"policy": "public." + item, "relation": relation,
                        "relation_absent_from_historical_upgrade": absent,
                        "classification": "OPTIONAL / INAPPLICABLE",
                        "basis": "Policy target table absent in hosted historical upgrade" if absent else
                                 "Target legacy public table has RLS enabled with no policy and denies browser-role rows; hosted routes do not require this clean-install policy. Callable legacy functions require separate review."})
out = {"format": "d5o-rc10-hosted-scope-triage-v1", "source_commit": "8b6b0d9e4aa484d0f0db1d075a969b79e01b0989",
       "database_network_mode": "none", "conditional_runtime": "D5O_HOSTED_ENABLED=1 and RYBEXOS_RUNTIME_MODE=production",
       "scope_warning": "Inapplicable to the frozen hosted D5O surface is not proof of historical migration equivalence or of unrelated legacy RPC security.",
       "missing_public_relations": relations,
       "missing_public_policies": policy_rows,
       "counts": {"relations": len(relations), "policies": len(policy_rows),
                  "relations_with_app_source_reference": sum(bool(x["application_source_references"]) for x in relations),
                  "relations_with_hosted_function_reference": sum(bool(x["hosted_function_name_references"]) for x in relations),
                  "policies_on_absent_tables": sum(x["relation_absent_from_historical_upgrade"] for x in policy_rows)}}
(EV / "D5O_RC10_SCOPE_TRIAGE.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out["counts"]))
