"""Guarded D5O historical upgrade. Default mode is read-only plan.

The same migration engine runs against a network-disabled Docker restoration or
an explicitly approved production PostgreSQL connection. This is not a backup.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/release/evidence"
MANIFEST_PATH = EVIDENCE / "D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json"
START_PATH = EVIDENCE / "D5O_RC9_START_FINGERPRINT.json"
PROJECT = "fcawktdjoxvahhgvkebx"
LOCAL_CONTAINER = "d5o-rc7-recovery-db"
BRIDGE_SHA = {
    "rc8_bridge_pre_215.sql": "0f076c496f756b8f56965b104cddd8c77c558344c89ca84cbf85946dfa924af5",
    "rc8_bridge_post_215.sql": "b15dcd56a30fc4b46e81ea792fbfd51e19213630b698bd5734334f0cccbdf5d8",
}
PROBES = {
    "ledger": "select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version) t",
    "workspaces": "select id::text from d5o_hosted.workspaces order by id",
    "auth_users": "select id::text from auth.users order by id",
    "storage_associations": "select id::text||'|'||bucket_id||'|'||name from storage.objects order by id",
    "legacy_invitation": "select workspace_id::text||'|'||command_id||'|'||requested_role||'|'||status||'|'||fingerprint from d5o_hosted.admin_identity_requests where action='invite' and requested_role='field_worker' and status='setup_completed'",
}
HISTORICAL = {
    "auth_users": ("auth.users", "to_jsonb(t) - 'encrypted_password' - 'confirmation_token' - 'recovery_token'"),
    "auth_identities": ("auth.identities", "to_jsonb(t) - 'identity_data'"),
    "memberships": ("d5o_hosted.memberships", "jsonb_build_array(workspace_id,actor_user_id,role,status)"),
    "invitation_history": ("d5o_hosted.admin_identity_requests", "jsonb_build_array(workspace_id,command_id,actor_user_id,action,target_email,reason,fingerprint,status,provider_user_id,created_at,resolved_at,requested_role,setup_completed_at)"),
    "work_records": ("d5o_hosted.work_records", "jsonb_build_array(id,workspace_id,configuration_version_id,work_type_key)"),
    "work_events": ("d5o_hosted.work_events", "to_jsonb(t)"),
    "configuration_versions": ("d5o_hosted.configuration_versions", "to_jsonb(t)-'source_template_version_id'"),
    "customer_evidence": ("d5o_hosted.customer_decision_evidence", "to_jsonb(t)"),
    "public_audit": ("public.audit_events", "to_jsonb(t)"),
    "storage_metadata": ("storage.objects", "to_jsonb(t)"),
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def source_commit():
    run = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
    return run.stdout.strip()

def fail(message):
    raise RuntimeError(message)

def load_sources():
    manifest_bytes = MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_bytes)["migrations"]
    if len(manifest) != 236 or [x["order"] for x in manifest] != list(range(1, 237)):
        fail("236-file manifest identity mismatch")
    for item in manifest:
        path = ROOT / "supabase/migrations" / item["filename"]
        if not path.is_file() or digest(path.read_bytes()) != item["sha256"]:
            fail("source migration checksum mismatch: " + item["filename"])
    for name, expected in BRIDGE_SHA.items():
        if digest((ROOT / "scripts" / name).read_bytes()) != expected:
            fail("RC8 bridge checksum mismatch: " + name)
    return manifest[211:], digest(manifest_bytes)

def production_environment(uri_file, project_ref, psql_binary):
    if project_ref != PROJECT:
        fail("wrong production project reference")
    if not uri_file or not psql_binary:
        fail("production connection file and psql binary are required")
    uri_path = Path(uri_file)
    if not uri_path.is_file():
        fail("production connection file missing")
    parsed = urlparse(uri_path.read_text(encoding="utf8").strip())
    if parsed.scheme not in ("postgres", "postgresql") or parsed.path != "/postgres":
        fail("unexpected PostgreSQL URI database")
    host = parsed.hostname or ""
    user = unquote(parsed.username or "")
    if PROJECT not in host and PROJECT not in user:
        fail("URI does not identify the approved Supabase project")
    if not (host.endswith(".supabase.co") or host.endswith(".pooler.supabase.com")):
        fail("unapproved PostgreSQL host")
    sslmode = parse_qs(parsed.query).get("sslmode", ["require"])[0]
    if sslmode not in ("require", "verify-ca", "verify-full"):
        fail("SSL is required")
    env = dict(os.environ)
    env.update(PGHOST=host, PGPORT=str(parsed.port or 5432), PGDATABASE="postgres",
               PGUSER=user, PGPASSWORD=unquote(parsed.password or ""), PGSSLMODE=sslmode)
    if not env["PGPASSWORD"]:
        fail("PostgreSQL password missing")
    return [psql_binary, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At"], env

def local_environment(container, project_ref):
    if project_ref != "LOCAL_REHEARSAL" or container != LOCAL_CONTAINER:
        fail("wrong local rehearsal target")
    check = subprocess.run(["docker", "inspect", container], capture_output=True, text=True, check=True)
    target = json.loads(check.stdout)[0]
    if target["HostConfig"]["NetworkMode"] != "none" or target["HostConfig"].get("PortBindings"):
        fail("rehearsal target is not network-isolated")
    return ["docker", "exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At"], dict(os.environ)

def sql_call(command, env, sql, timeout=180):
    run = subprocess.run(command, input=sql, capture_output=True, text=True, encoding="utf8", env=env, timeout=timeout)
    if run.returncode:
        # Never print raw provider diagnostics or values from historical rows.
        line = next((x for x in run.stderr.splitlines() if "ERROR:" in x), "SQL execution failed")
        line = re.sub(r"'[^']*'", "'[redacted]'", line)[:200]
        fail(line)
    return run.stdout.strip()

def fingerprint(command, env, resume_count=None):
    expected = json.loads(START_PATH.read_text(encoding="utf8"))["fingerprints_sha256"]
    for label, query in PROBES.items():
        if label == "ledger" and resume_count is not None:
            query = "select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version limit 177) t"
        if digest(sql_call(command, env, query + ";").encode()) != expected[label]:
            fail("approved starting fingerprint mismatch: " + label)
    if sql_call(command, env, "select current_database()") != "postgres":
        fail("unexpected database name")
    if resume_count is None and sql_call(command, env, "select count(*)||'|'||max(version) from supabase_migrations.schema_migrations") != "177|20261021123923":
        fail("starting ledger mismatch")

def verified_resume_prefix(command, env, selected, resume_count):
    if not 178 <= resume_count <= 201:
        fail("resume ledger count outside reviewed partial-migration range")
    actual = sql_call(command, env, "select version from supabase_migrations.schema_migrations order by version offset 177")
    expected = [item["version"] for item in selected[:resume_count - 177]]
    if actual.splitlines() != expected:
        fail("partial ledger versions are not the exact reviewed prefix")
    for item in selected[:resume_count - 177]:
        parts = [(ROOT / "supabase/migrations" / item["filename"]).read_text(encoding="utf8")]
        if item["order"] == 215:
            parts = [(ROOT / "scripts/rc8_bridge_pre_215.sql").read_text(), parts[0],
                     (ROOT / "scripts/rc8_bridge_post_215.sql").read_text()]
        literal_parts = "array[" + ",".join(literal(part) for part in parts) + "]::text[]"
        matched = sql_call(command, env, "select coalesce((select statements=" + literal_parts +
                           " from supabase_migrations.schema_migrations where version=" + literal(item["version"]) + "),false)")
        if matched != "t":
            fail("partial ledger SQL differs from reviewed source at order " + str(item["order"]))
    return selected[resume_count - 177:]

def historical_hashes(command, env):
    parts = ["select '" + label + "' as label,md5(coalesce(string_agg(md5((" + expr + ")::text),'|' order by md5((" + expr + ")::text)),'')) from " + table + " t"
             for label, (table, expr) in HISTORICAL.items()]
    return dict(row.split("|", 1) for row in sql_call(command, env, " union all ".join(parts)).splitlines())

def approval_check(args, manifest_sha):
    if args.mode not in ("apply-production", "resume-production"):
        return
    if not args.approval_file or not os.environ.get("D5O_APPROVAL_FILE_SHA256"):
        fail("separate release-owner approval artifact and pinned hash required")
    raw = Path(args.approval_file).read_bytes()
    if digest(raw) != os.environ["D5O_APPROVAL_FILE_SHA256"].lower():
        fail("approval artifact hash mismatch")
    approval = json.loads(raw)
    if subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain"], capture_output=True, text=True, check=True).stdout.strip():
        fail("production apply requires a clean committed worktree")
    required = {"projectRef": PROJECT, "sourceCommit": source_commit(),
                "manifestSha256": manifest_sha,
                "startingLedgerSha256": json.loads(START_PATH.read_text())["fingerprints_sha256"]["ledger"]}
    if any(approval.get(key) != value for key, value in required.items()):
        fail("approval identity mismatch")
    if args.mode == "resume-production" and (approval.get("resumeFromLedger") != args.resume_from_ledger or
                                             approval.get("reviewedPartialStop") is not True):
        fail("separate partial-migration review and exact resume ledger approval required")
    if not approval.get("approvalId") or not approval.get("releaseOwner") or not approval.get("checkpointId"):
        fail("incomplete release approval")
    if not args.drift_baseline_file or not approval.get("driftBaselineSha256"):
        fail("post-checkpoint drift baseline and approved hash required")
    baseline = Path(args.drift_baseline_file).resolve()
    if not baseline.is_file() or digest(baseline.read_bytes()) != approval["driftBaselineSha256"]:
        fail("post-checkpoint drift baseline hash mismatch")
    expiry = dt.datetime.fromisoformat(approval["expiresUtc"].replace("Z", "+00:00"))
    if expiry <= dt.datetime.now(dt.timezone.utc):
        fail("release approval expired")

def literal(value):
    return "convert_from(decode('" + value.encode("utf8").hex() + "','hex'),'UTF8')"

def apply_order(command, env, item, inject_failure):
    source = (ROOT / "supabase/migrations" / item["filename"]).read_text(encoding="utf8")
    parts = [source]
    if item["order"] == 215:
        parts = [(ROOT / "scripts/rc8_bridge_pre_215.sql").read_text(), source,
                 (ROOT / "scripts/rc8_bridge_post_215.sql").read_text()]
    name = item["filename"].split("_", 1)[1].removesuffix(".sql")
    statements = "array[" + ",".join(literal(part) for part in parts) + "]::text[]"
    sql = "\n".join(["begin;", "set local lock_timeout='5s';", "set local statement_timeout='120s';",
                     *parts, "select 1/0;" if inject_failure else "select 1;",
                     "insert into supabase_migrations.schema_migrations(version,statements,name) values (" +
                     literal(item["version"]) + "," + statements + "," + literal(name) + ");", "commit;"])
    sql_call(command, env, sql, timeout=240)
    actual = sql_call(command, env, "select cardinality(statements) from supabase_migrations.schema_migrations where version=" + literal(item["version"]))
    if actual != str(len(parts)):
        fail("migration ledger statement count mismatch")
    return len(parts)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=("plan", "apply-rehearsal", "apply-production", "resume-rehearsal", "resume-production"), default="plan")
    ap.add_argument("--transport", choices=("docker", "psql"), required=True)
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--container", default=LOCAL_CONTAINER)
    ap.add_argument("--uri-file")
    ap.add_argument("--psql-binary")
    ap.add_argument("--approval-file")
    ap.add_argument("--drift-baseline-file")
    ap.add_argument("--inject-failure-order", type=int)
    ap.add_argument("--resume-from-ledger", type=int)
    args = ap.parse_args()
    if (args.transport == "docker") != (args.project_ref == "LOCAL_REHEARSAL"):
        fail("transport and target identity disagree")
    if args.mode in ("apply-production", "resume-production") and args.transport != "psql":
        fail("production apply requires production transport")
    if args.mode in ("apply-rehearsal", "resume-rehearsal") and args.transport != "docker":
        fail("rehearsal apply requires isolated Docker transport")
    if (args.mode.startswith("resume-") != (args.resume_from_ledger is not None)):
        fail("resume mode requires an exact partial ledger count")
    if args.inject_failure_order and (args.mode != "apply-rehearsal" or args.inject_failure_order not in range(212, 237)):
        fail("failure injection allowed only for rehearsal orders 212-236")
    selected, manifest_sha = load_sources()
    approval_check(args, manifest_sha)  # Before connecting or writing.
    command, env = (local_environment(args.container, args.project_ref) if args.transport == "docker"
                    else production_environment(args.uri_file, args.project_ref, args.psql_binary))
    fingerprint(command, env, args.resume_from_ledger)
    if args.mode.startswith("resume-"):
        if sql_call(command, env, "select count(*) from supabase_migrations.schema_migrations") != str(args.resume_from_ledger):
            fail("partial ledger count changed")
        selected = verified_resume_prefix(command, env, selected, args.resume_from_ledger)
    if args.mode in ("apply-production", "resume-production"):
        drift = subprocess.run(["node", str(ROOT / "scripts/production/checkpoint-drift.mjs"),
                                "compare", args.uri_file, args.drift_baseline_file],
                               capture_output=True, text=True, timeout=90)
        if drift.returncode != 0 or json.loads(drift.stdout).get("status") != "UNCHANGED":
            fail("post-checkpoint Auth, business, ledger or Storage metadata drift; do not migrate")
    result = {"mode": args.mode, "target": args.project_ref, "sourceCommit": source_commit(),
              "manifestSha256": manifest_sha, "startingLedger": args.resume_from_ledger or 177,
              "orders": [], "status": "PREFLIGHT_PASS"}
    if args.mode == "plan":
        result["orders"] = [{"order": x["order"], "sha256": x["sha256"]} for x in selected]
        print(json.dumps(result))
        return
    before = historical_hashes(command, env)
    for item in selected:
        try:
            count = apply_order(command, env, item, args.inject_failure_order == item["order"])
        except RuntimeError as error:
            result["status"] = "STOPPED"
            result["failedOrder"] = item["order"]
            result["error"] = str(error)
            result["ledgerAfterStop"] = sql_call(command, env, "select count(*) from supabase_migrations.schema_migrations")
            stopped_hashes = historical_hashes(command, env)
            result["historicalHashesPreservedOnStop"] = {
                name: value == stopped_hashes[name] for name, value in before.items()}
            print(json.dumps(result))
            sys.exit(2)
        result["orders"].append({"order": item["order"], "ledgerStatements": count})
    result["endingLedger"] = sql_call(command, env, "select count(*) from supabase_migrations.schema_migrations")
    after = historical_hashes(command, env)
    result["historicalHashesPreserved"] = {name: value == after[name]
                                          for name, value in before.items()}
    security = sql_call(command, env, "select (select convalidated from pg_constraint where conrelid='d5o_hosted.admin_identity_requests'::regclass and conname='admin_identity_requests_role_check'),(select relrowsecurity from pg_class where oid='d5o_hosted.rc8_invitation_bridge_receipts'::regclass)")
    result["bridgeSecurity"] = security
    result["status"] = ("PASS" if result["endingLedger"] == "202" and
                        all(result["historicalHashesPreserved"].values()) and security == "t|t" else "FAIL")
    print(json.dumps(result))
    if result["status"] != "PASS":
        sys.exit(3)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "STOPPED", "error": str(error)[:200]}))
        sys.exit(2)
