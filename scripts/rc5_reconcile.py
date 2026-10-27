import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REL = ROOT / "docs/release"
EV = REL / "evidence"
manifest = json.loads((EV / "D5O_RC4B1_MIGRATION_CHECKSUMS.json").read_text())
ledger = json.loads((EV / "D5O_RC5_PRODUCTION_LEDGER.json").read_text())["rows"]
old = json.loads((REL / "D5O_RC1_HOSTED_LEDGER_STATEMENT_HASHES.json").read_text())["rows"]
old_by_version = {r["version"]: r for r in old}
ledger_by_version = {r["version"]: r for r in ledger}
source = manifest["migrations"]
source_by_version = {r["version"]: r for r in source}
assert len(source) == len(source_by_version) == 236
assert len(ledger) == len(ledger_by_version) == 177

for row in source:
    path = ROOT / "supabase/migrations" / row["filename"]
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual == row["sha256"], (path, actual, row["sha256"])
assert source[-1]["sha256"] == "6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8"
all_files = {p.name for p in (ROOT / "supabase/migrations").glob("*.sql")}
assert all_files - {r["filename"] for r in source} == {"0016_p1_01b_2_bid_submission_outcome-ShawnT13.sql"}
assert len(all_files) == 237

changed_ledger = []
for row in ledger:
    previous = old_by_version.get(row["version"])
    if previous is None or previous["name"] != row["name"] or previous["statement_count"] != row["statement_count"] or previous["ledger_statement_sha256"] != row["statements_sha256"]:
        changed_ledger.append(row["version"])

by_name = {}
for row in source:
    by_name.setdefault(row["filename"].split("_", 1)[1].removesuffix(".sql"), []).append(row)
remaps = {}
for row in ledger:
    if row["version"] not in source_by_version:
        normalized_name = re.sub(r"_\d{14}$", "", row["name"])
        matches = by_name.get(normalized_name, [])
        if len(matches) == 1:
            remaps[matches[0]["version"]] = row["version"]

comparison = []
hash_match_counts = {}
for row in source:
    hosted = ledger_by_version.get(row["version"])
    remap = ledger_by_version.get(remaps.get(row["version"]))
    match_kind = None
    observed = hosted or remap
    if observed:
        body = (ROOT / "supabase/migrations" / row["filename"]).read_bytes().decode("utf-8")
        variants = {
            "RAW FILE BYTES": body,
            "LF LINE ENDINGS": body.replace("\r\n", "\n"),
            "CRLF LINE ENDINGS": body.replace("\r\n", "\n").replace("\n", "\r\n"),
            "TRIMMED OUTER WHITESPACE": body.strip(),
            "LF PLUS TRIMMED OUTER WHITESPACE": body.replace("\r\n", "\n").strip(),
        }
        for kind, value in variants.items():
            if hashlib.sha256(value.encode()).hexdigest() == observed["statements_sha256"]:
                match_kind = kind
                break
    hash_match_counts[match_kind or "NONE"] = hash_match_counts.get(match_kind or "NONE", 0) + 1
    source_sql = (ROOT / "supabase/migrations" / row["filename"]).read_bytes().decode("utf-8")
    object_effect_hints = sorted(set(
        " ".join(m.groups()).strip()
        for m in re.finditer(r"(?im)^\s*(create|alter|drop)\s+(?:or\s+replace\s+)?(schema|table|view|function|procedure|trigger|index|policy|type)\s+(?:if\s+(?:not\s+)?exists\s+)?([a-zA-Z_][a-zA-Z_0-9.\"]*)", source_sql)
    ))
    if match_kind == "RAW FILE BYTES":
        classification = "EXACT MATCH"
        treatment = "Recorded ledger SQL bytes equal frozen source bytes; preserve as applied."
    elif match_kind:
        classification = "SQL-EQUIVALENT WITH EVIDENCE"
        treatment = "Stored SQL differs only by the named byte normalization; preserve as applied."
    elif hosted:
        classification = "HISTORICAL ENTRY UNRESOLVED"
        treatment = "Compare stored SQL and effective objects on authorized protected copy; do not replay or mark applied yet."
    elif remap:
        classification = "HISTORICAL ENTRY UNRESOLVED"
        treatment = "Possible name-based version remap; prove stored SQL and object effects before replay decision."
    else:
        classification = "HISTORICAL ENTRY UNRESOLVED"
        treatment = "Source version absent from hosted ledger; evaluate prerequisite and drift before forward application."
    if remap and match_kind:
        treatment = "SQL text proved under hosted version, but source version remains absent; preserve effect and resolve ledger-version handling on protected copy without fabricated history."
    comparison.append({
        "order": row["order"], "source_file": row["filename"], "source_version": row["version"],
        "source_sha256": row["sha256"], "hosted_version": (hosted or remap or {}).get("version"),
        "hosted_name": (hosted or remap or {}).get("name"),
        "hosted_statements_sha256": (hosted or remap or {}).get("statements_sha256"),
        "hosted_statement_count": (hosted or remap or {}).get("statement_count"),
        "source_depends_on": row["dependsOn"],
        "source_object_effect_hints": object_effect_hints,
        "effect_hints_are_static_only": True,
        "version_name_match": bool(hosted and hosted["name"] == row["filename"].split("_", 1)[1].removesuffix(".sql")),
        "classification": classification, "sql_hash_match_kind": match_kind,
        "exact_sql_equivalence": "PROVEN" if match_kind == "RAW FILE BYTES" else "UNKNOWN",
        "effective_schema_equivalence": "NOT ESTABLISHED PER MIGRATION",
        "hosted_object_conflict": "UNKNOWN",
        "treatment": treatment
    })
hosted_only = [r for r in ledger if r["version"] not in source_by_version and r["version"] not in remaps.values()]
result = {
    "format": "d5o-rc5-production-ledger-comparison-v1",
    "source_commit": "dcb72a3868e48d536449e109872403974b79fa1b",
    "production_project": "fcawktdjoxvahhgvkebx",
    "counts": {
        "source_executable": len(source), "hosted_ledger": len(ledger),
        "shared_versions": sum(r["version"] in ledger_by_version for r in source),
        "name_linked_version_remaps": len(remaps),
        "hosted_only_unmatched": len(hosted_only),
        "source_only_versions": sum(r["version"] not in ledger_by_version for r in source),
        "rc1_ledger_rows_changed": len(changed_ledger)
    },
    "rc1_ledger_changed_versions": changed_ledger,
    "hash_match_counts": hash_match_counts,
    "remaps_sql_text_proved": sum(bool(r["sql_hash_match_kind"]) and r["hosted_version"] != r["source_version"]
                                  for r in comparison if r["hosted_version"]),
    "source_migrations": comparison,
    "unmatched_hosted_entries": hosted_only,
    "name_linked_remaps": remaps
}
(EV / "D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
(EV / "D5O_RC5_LEDGER_COMPARISON.json").write_text(json.dumps(result, indent=2) + "\n")
unresolved = [
    {"id": "SRC-" + r["source_version"], "order": r["order"], "source_file": r["source_file"],
     "hosted_version": r["hosted_version"], "reason": "stored SQL hash differs from frozen source" if r["hosted_version"] else "source version absent from hosted ledger",
     "required_evidence": "stored SQL diff, object-level dependency and historical-data behavior on authorized protected copy"}
    for r in comparison if r["classification"] == "HISTORICAL ENTRY UNRESOLVED"
]
unresolved += [
    {"id": "REMAP-" + r["source_version"], "order": r["order"], "source_file": r["source_file"],
     "hosted_version": r["hosted_version"], "reason": "SQL text matches but hosted ledger version differs",
     "required_evidence": "reviewed version mapping and safe forward executor behavior without fabricated ledger history"}
    for r in comparison if r["hosted_version"] and r["hosted_version"] != r["source_version"] and r["sql_hash_match_kind"]
]
unresolved += [
    {"id": "HOST-" + r["version"], "hosted_version": r["version"], "hosted_name": r["name"],
     "reason": "hosted legacy entry has no source file",
     "required_evidence": "retained historical SQL and object effects on authorized protected copy"}
    for r in hosted_only
]
(EV / "D5O_RC5_UNRESOLVED_DISCREPANCIES.json").write_text(json.dumps({"count": len(unresolved), "items": unresolved}, indent=2) + "\n")
proposal = [{
    "order": r["order"], "filename": r["source_file"], "version": r["source_version"],
    "source_sha256": r["source_sha256"], "hosted_version": r["hosted_version"],
    "action": "STOP_RESOLVE_VERSION_REMAP" if r["hosted_version"] and r["hosted_version"] != r["source_version"] else
        "PRESERVE_APPLIED" if r["classification"] in ("EXACT MATCH", "SQL-EQUIVALENT WITH EVIDENCE") else
        "STOP_RECONCILE_HISTORICAL_SQL" if r["hosted_version"] else "STOP_VERIFY_PENDING_PREREQUISITE",
    "classification": r["classification"]
} for r in comparison]
(EV / "D5O_RC5_ORDERED_MIGRATION_PROPOSAL.json").write_text(json.dumps({
    "status": "CONDITIONAL_NOT_EXECUTABLE",
    "first_stop_order": next(r["order"] for r in proposal if r["action"].startswith("STOP")),
    "migrations": proposal
}, indent=2) + "\n")
print(json.dumps(result["counts"]))
print("unmatched hosted:", [r["version"] for r in hosted_only])
