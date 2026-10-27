"""Compare restored historical ledger SQL with frozen source without exporting SQL."""
import hashlib, json, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EV = ROOT / "docs/release/evidence"
manifest = json.loads((EV / "D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json").read_text())
comparison = json.loads((EV / "D5O_RC5_LEDGER_COMPARISON.json").read_text())
query = "select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version) t"
cmd = ["docker", "exec", "d5o-rc7-historical-db", "psql", "-U", "supabase_admin", "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", query]
check = subprocess.run(["docker", "inspect", "d5o-rc7-historical-db"], capture_output=True, text=True, check=True)
target = json.loads(check.stdout)[0]
assert target["HostConfig"]["NetworkMode"] == "none" and not target["HostConfig"].get("PortBindings")
run = subprocess.run(cmd, capture_output=True, text=True, check=True)
ledger = {r["version"]: r for r in map(json.loads, run.stdout.splitlines())}
assert len(ledger) == 177
sha = lambda x: hashlib.sha256(x.encode()).hexdigest()
def sql_tokens(s):
    """Conservative PostgreSQL lexer; comments/outer whitespace carry no SQL effect."""
    out=[]; i=0; n=len(s)
    while i<n:
        c=s[i]
        if c.isspace(): i+=1; continue
        if s.startswith('--',i):
            end=s.find('\n',i+2); i=n if end<0 else end+1; continue
        if s.startswith('/*',i):
            depth=1; i+=2
            while i<n and depth:
                if s.startswith('/*',i): depth+=1; i+=2
                elif s.startswith('*/',i): depth-=1; i+=2
                else: i+=1
            if depth: return None
            continue
        if c=='$':
            m=re.match(r'\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$',s[i:])
            if m:
                tag=m.group(); end=s.find(tag,i+len(tag))
                if end<0: return None
                out.append(s[i:end+len(tag)]); i=end+len(tag); continue
        if c in "'\"":
            start=i; i+=1
            while i<n:
                if s[i]==c:
                    if i+1<n and s[i+1]==c: i+=2; continue
                    i+=1; break
                # Backslash escapes require parser context. Decline proof.
                if s[i]=='\\' and i+1<n and s[i+1]==c: return None
                i+=1
            else: return None
            out.append(s[start:i]); continue
        if c.isalpha() or c=='_':
            m=re.match(r'[A-Za-z_][A-Za-z_0-9$]*',s[i:]); out.append(m.group()); i+=len(m.group()); continue
        if c.isdigit():
            m=re.match(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',s[i:]); out.append(m.group()); i+=len(m.group()); continue
        out.append(c); i+=1
    return out
results = []
counts = {}
for row in comparison["source_migrations"]:
    hosted = ledger.get(row["hosted_version"])
    source = (ROOT / "supabase/migrations" / row["source_file"]).read_bytes().decode("utf-8")
    if hosted is None:
        kind = "NO_HOSTED_SQL_LINK"
        stored_sha = None
        statement_count = None
        whitespace_erased_equal = None
        token_equal = None
    else:
        statements = hosted["statements"] or []
        stored = "".join(statements)
        variants = {
            "EXACT_BYTES": source,
            "LINE_ENDINGS_ONLY": source.replace("\r\n", "\n"),
            "CRLF_LINE_ENDINGS_ONLY": source.replace("\r\n", "\n").replace("\n", "\r\n"),
            "OUTER_WHITESPACE_ONLY": source.strip(),
            "LINE_ENDINGS_AND_OUTER_WHITESPACE": source.replace("\r\n", "\n").strip(),
        }
        kind = next((name for name, value in variants.items() if value == stored), "SQL_TEXT_DIFFERS")
        stored_sha = sha(stored)
        statement_count = len(statements)
        whitespace_erased_equal = re.sub(r"\s+", "", source) == re.sub(r"\s+", "", stored)
        source_tokens, stored_tokens = sql_tokens(source), sql_tokens(stored)
        token_equal = source_tokens is not None and source_tokens == stored_tokens
        if kind == "SQL_TEXT_DIFFERS" and token_equal: kind = "LEXICALLY_EQUIVALENT_COMMENTS_WHITESPACE"
    counts[kind] = counts.get(kind, 0) + 1
    results.append({"order": row["order"], "source_file": row["source_file"],
        "source_version": row["source_version"], "hosted_version": row["hosted_version"],
        "retained_sql_comparison": kind, "retained_statement_count": statement_count,
        "retained_sql_sha256": stored_sha,
        "whitespace_erased_equal_candidate_only": whitespace_erased_equal,
        "sql_token_equivalent": token_equal if hosted is not None else None,
        "historical_execution_proven": bool(hosted and kind != "SQL_TEXT_DIFFERS")})
out = {"format": "d5o-rc7-retained-sql-comparison-v1", "starting_ledger_count": len(ledger),
    "counts": counts, "rows": results,
    "note": "SQL_TEXT_DIFFERS requires semantic, object, permission, and data-effect review. Source-only versions remain unproved."}
(EV / "D5O_RC7_RETAINED_SQL_COMPARISON.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(counts))
