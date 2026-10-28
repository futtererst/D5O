"""Build sanitized RC19 route and catalog dispositions from captured local evidence."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
evidence = root / "docs/release/evidence"
def load(name):
    return json.loads((evidence / name).read_text(encoding="utf-8"))

rc18 = load("D5O_RC18_ACTIVE_CATALOG_COMPARISON.json")
effective = load("D5O_RC19_EFFECTIVE_SQL_COMPARISON.json")
inventory = load("D5O_RC10_HOSTED_RPC_INVENTORY.json")
by_signature = {row["key"]: row for row in effective["definitionComparisons"]}
by_name = {row["name"]: row for row in inventory["calls"]}
metadata = ["return_type", "language", "volatility", "strict", "parallel",
            "leakproof", "config", "defaults", "anon_exec", "auth_exec"]
rpc_rows = []
for name, prior in sorted(rc18["activeRpc"].items()):
    source = by_name[name]["sources"]
    entries = []
    for difference in prior["sharedDifferences"]:
        key = difference["signature"]
        comparison = by_signature[key]
        contract_matches = comparison["presentInHistorical"] and comparison["bodyNormalized"] \
            and all(comparison[field + "Match"] for field in metadata)
        service_only = contract_matches and not comparison["service_execMatch"]
        entries.append({"signature": key, "rc18Fields": difference["fields"],
                        "normalizedBodyEqualWithQuotedValuesPreserved": comparison["bodyNormalized"],
                        "returnAndExecutionAttributesEqual": all(comparison[field + "Match"] for field in metadata),
                        "serviceRoleGrantDifferent": service_only,
                        "disposition": "INTENTIONAL COMPATIBLE DIFFERENCE" if service_only else
                        "EQUIVALENT" if contract_matches else "UNRESOLVED RELEASE BLOCKER"})
    if prior["missingSignatures"] or prior["historicalOnlySignatures"]:
        disposition = "UNRESOLVED RELEASE BLOCKER"
    elif any(row["disposition"] == "UNRESOLVED RELEASE BLOCKER" for row in entries):
        disposition = "UNRESOLVED RELEASE BLOCKER"
    elif any(row["disposition"] == "INTENTIONAL COMPATIBLE DIFFERENCE" for row in entries):
        disposition = "INTENTIONAL COMPATIBLE DIFFERENCE"
    else:
        disposition = "EQUIVALENT"
    rpc_rows.append({"name": name, "sources": source,
                     "productionMode": "admitted by /api/d5o-hosted or protected /work route; transitive helper where listed",
                     "rc18HadDifference": bool(prior["sharedDifferences"] or prior["missingSignatures"]
                                                or prior["historicalOnlySignatures"]),
                     "disposition": disposition, "signatures": entries})

# RC10's literal inventory covered hosted RPCs; RC18 opened two platform API routes.
# Add their direct calls to the release-reachable set rather than silently omitting them.
for route in ["app/api/d5o-platform/provisioning/route.ts",
              "app/api/d5o-platform/initial-admin-accept/route.ts"]:
    text = (root / route).read_text(encoding="utf-8")
    for name in sorted(set(re.findall(r'"(d5o_platform_[a-z0-9_]+)"', text))):
        comparisons = [row for row in effective["definitionComparisons"]
                       if row["kind"] == "function" and row["key"].split("(")[0].endswith("." + name)]
        entries = []
        for comparison in comparisons:
            contract_matches = comparison["presentInHistorical"] and comparison["bodyNormalized"] \
                and all(comparison[field + "Match"] for field in metadata)
            service_only = contract_matches and not comparison["service_execMatch"]
            entries.append({"signature": comparison["key"],
                            "normalizedBodyEqualWithQuotedValuesPreserved": comparison.get("bodyNormalized"),
                            "returnAndExecutionAttributesEqual": contract_matches,
                            "serviceRoleGrantDifferent": service_only,
                            "disposition": "INTENTIONAL COMPATIBLE DIFFERENCE" if service_only else
                            "EQUIVALENT" if contract_matches else "UNRESOLVED RELEASE BLOCKER"})
        disposition = ("UNRESOLVED RELEASE BLOCKER" if not entries or any(
            row["disposition"] == "UNRESOLVED RELEASE BLOCKER" for row in entries) else
            "INTENTIONAL COMPATIBLE DIFFERENCE" if any(row["serviceRoleGrantDifferent"] for row in entries)
            else "EQUIVALENT")
        rpc_rows.append({"name": name, "sources": [route], "productionMode": "exact admitted platform API route",
                         "rc18HadDifference": False, "additionalRC19PlatformCall": True,
                         "disposition": disposition, "signatures": entries})

policy_rows = []
for row in effective["definitionComparisons"]:
    if row["kind"] != "policy":
        continue
    policy_rows.append({"policy": row["key"],
                        "predicateDifference": "displayed auth.uid() qualification only" if row["uidQualifierOnly"] else "unresolved",
                        "historicalDependency": "auth.uid verified through pg_depend",
                        "disposition": "EQUIVALENT" if row["uidQualifierOnly"] else "UNRESOLVED RELEASE BLOCKER"})

grant_rows = []
for row in rc18["securityExceptions"]:
    comparison = by_signature[row["signature"]]
    name = row["signature"].split("(")[0].split(".")[-1]
    compatible = row["field"] == "service_execute" and row["clean"] is False \
        and row["historical"] is True and comparison["anon_execMatch"] \
        and comparison["auth_execMatch"] and comparison["bodyNormalized"]
    grant_rows.append({"signature": row["signature"], "sources": by_name.get(name, {}).get("sources", []),
                       "field": row["field"], "clean": row["clean"], "historical": row["historical"],
                       "noAnonOrAuthenticatedExpansion": comparison["anon_execMatch"] and comparison["auth_execMatch"],
                       "disposition": "INTENTIONAL COMPATIBLE DIFFERENCE" if compatible
                       else "UNRESOLVED RELEASE BLOCKER"})

constraint_rows = []
for row in effective["definitionComparisons"]:
    if row["kind"] != "constraint" or not row["presentInHistorical"] or row["bodyNormalized"]:
        continue
    qualifier_only = row["cleanDefinition"].replace("auth.users", "users") == row["historicalDefinition"]
    bridge = row["key"] == "d5o_hosted.admin_identity_requests.admin_identity_requests_role_check"
    constraint_rows.append({"constraint": row["key"],
                            "difference": "Auth users schema qualification" if qualifier_only else
                            "reviewed RC8 historical field-worker invitation compatibility" if bridge else "unresolved",
                            "disposition": "EQUIVALENT" if qualifier_only else
                            "INTENTIONAL COMPATIBLE DIFFERENCE" if bridge else "UNRESOLVED RELEASE BLOCKER"})
legacy_clean_only = [row["key"] for row in effective["definitionComparisons"]
                     if row["kind"] == "function" and not row["presentInHistorical"]]
hosted_names = {row["name"] for row in rpc_rows}
if any(key.split("(")[0].split(".")[-1] in hosted_names for key in legacy_clean_only):
    raise RuntimeError("clean-only function is release-reachable")

out = {"format": "d5o-rc19-route-catalog-dispositions-v1",
       "sourceCommit": "6f0bbc8d9ba916c75bf2149a8eaef6e667896072",
       "cleanLedger": 236, "historicalLedger": 202,
       "scope": "literal hosted RPC inventory plus exact platform routes and catalog metadata; not a full historical command execution suite",
       "rpc": rpc_rows, "policies": policy_rows, "grants": grant_rows,
       "constraints": constraint_rows, "cleanOnlyLegacyFunctions": legacy_clean_only,
       "historicalOnlyRc8ReceiptConstraints": [
           key for key in load("D5O_RC18_HISTORICAL_CATALOG.json")["objects"]["constraint"]
           if key not in load("D5O_RC18_CLEAN_CATALOG.json")["objects"]["constraint"]],
       "summary": {"rpcNames": len(rpc_rows),
                   "differingRpcNames": sum(x["rc18HadDifference"] for x in rpc_rows),
                   "additionalPlatformRpcNames": sum(x.get("additionalRC19PlatformCall",False) for x in rpc_rows),
                   "rpcBlockers": sum(x["disposition"] == "UNRESOLVED RELEASE BLOCKER" for x in rpc_rows),
                   "policies": len(policy_rows), "policyBlockers": sum(x["disposition"] == "UNRESOLVED RELEASE BLOCKER" for x in policy_rows),
                   "grants": len(grant_rows), "grantBlockers": sum(x["disposition"] == "UNRESOLVED RELEASE BLOCKER" for x in grant_rows),
                   "constraintDifferences": len(constraint_rows),
                   "constraintBlockers": sum(x["disposition"] == "UNRESOLVED RELEASE BLOCKER" for x in constraint_rows),
                   "cleanOnlyLegacyFunctions": len(legacy_clean_only)}}
(evidence / "D5O_RC19_ROUTE_CONTRACT_DISPOSITIONS.json").write_text(
    json.dumps(out, indent=2) + "\n", encoding="utf-8")
print(json.dumps(out["summary"]))
