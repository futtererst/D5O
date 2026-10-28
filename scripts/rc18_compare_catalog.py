"""Compare sanitized clean and historical D5O fingerprints; never read business rows."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
ev = root / "docs/release/evidence"
clean = json.loads((ev / "D5O_RC18_CLEAN_CATALOG.json").read_text(encoding="utf-8"))
historical = json.loads((ev / "D5O_RC18_HISTORICAL_CATALOG.json").read_text(encoding="utf-8"))
rpc_inventory = json.loads((ev / "D5O_RC10_HOSTED_RPC_INVENTORY.json").read_text(encoding="utf-8"))
assert clean["kind"] == "clean_236" and historical["kind"] == "historical_upgraded"
assert rpc_inventory["literal_rpc_call_count"] == 112
active_names = {item["name"] for item in rpc_inventory["calls"]}
out = {"format": "d5o-rc18-active-catalog-comparison-v1", "sources": [
    "D5O_RC18_CLEAN_CATALOG.json", "D5O_RC18_HISTORICAL_CATALOG.json"],
    "counts": {}, "activeRpc": {}, "securityExceptions": [], "rlsExceptions": []}
for kind in ("function", "relation", "policy", "constraint"):
    a, b = clean["objects"][kind], historical["objects"][kind]
    shared = set(a) & set(b)
    differing = [key for key in sorted(shared) if a[key] != b[key]]
    out["counts"][kind] = {"clean": len(a), "historical": len(b),
        "missingInHistorical": len(set(a) - set(b)),
        "historicalOnly": len(set(b) - set(a)), "sharedDiffering": len(differing)}
    if kind == "function":
        for key in shared:
            x, y = a[key], b[key]
            for field in ("security_definer", "anon_execute", "authenticated_execute",
                          "service_execute", "owner"):
                if x[field] != y[field]:
                    out["securityExceptions"].append({"signature": key, "field": field,
                        "clean": x[field], "historical": y[field]})
    if kind == "relation":
        for key in shared:
            x, y = a[key], b[key]
            for field in ("rls", "force_rls", "anon_select", "authenticated_select"):
                if x[field] != y[field]:
                    out["rlsExceptions"].append({"relation": key, "field": field,
                        "clean": x[field], "historical": y[field]})
functions_clean = clean["objects"]["function"]
functions_historical = historical["objects"]["function"]
for name in sorted(active_names):
    a = {k: v for k, v in functions_clean.items() if k.split(".")[-1].split("(")[0] == name}
    b = {k: v for k, v in functions_historical.items() if k.split(".")[-1].split("(")[0] == name}
    keys = set(a) | set(b)
    out["activeRpc"][name] = {
        "cleanSignatures": len(a), "historicalSignatures": len(b),
        "missingSignatures": sorted(set(a) - set(b)),
        "historicalOnlySignatures": sorted(set(b) - set(a)),
        "sharedDifferences": [
            {"signature": key, "fields": sorted(field for field in a[key] if a[key][field] != b[key][field])}
            for key in sorted(set(a) & set(b)) if a[key] != b[key]],
    }
out["summary"] = {"activeRpcNames": len(active_names),
    "activeRpcNamesMissingInHistorical": sum(not value["historicalSignatures"] for value in out["activeRpc"].values()),
    "activeRpcNamesWithSignatureOrFieldDifferences": sum(bool(value["missingSignatures"] or
        value["historicalOnlySignatures"] or value["sharedDifferences"])
        for value in out["activeRpc"].values()),
    "securityExceptions": len(out["securityExceptions"]),
    "relationRlsOrGrantExceptions": len(out["rlsExceptions"])}
(ev / "D5O_RC18_ACTIVE_CATALOG_COMPARISON.json").write_text(
    json.dumps(out, indent=2) + "\n", encoding="utf-8")
print(json.dumps(out["summary"]))
