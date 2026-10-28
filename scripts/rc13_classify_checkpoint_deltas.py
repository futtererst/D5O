"""Compare original keys and changed field names, never emit protected values."""
import collections, json, subprocess
from pathlib import Path

TABLES = [
    'd5o_hosted.admin_identity_requests', 'd5o_hosted.configuration_template_versions',
    'd5o_hosted.configuration_templates', 'd5o_hosted.connected_phase_status',
    'd5o_hosted.prototype_states', 'd5o_hosted.rc8_invitation_bridge_receipts',
    'd5o_hosted.workspaces', 'storage.migrations',
]

def query(container, sql):
    p = subprocess.run(['docker', 'exec', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
                        '-At', '-c', sql], capture_output=True, text=True, encoding='utf-8', check=True)
    return p.stdout.splitlines()

def keys(table):
    schema, name = table.split('.')
    sql = f"select a.attname from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=any(i.indkey) where i.indisprimary and n.nspname='{schema}' and c.relname='{name}' order by a.attnum"
    return query('d5o-rc7-recovery-db', sql)

def rows(container, table, columns):
    data = [json.loads(line) for line in query(container, f'select row_to_json(t)::text from {table} t')]
    return {tuple(str(row.get(column)) for column in columns): row for row in data}

out = []
for table in TABLES:
    columns = keys(table)
    if not columns:
        raise RuntimeError(f'primary key absent: {table}')
    old, new = rows('d5o-rc7-recovery-db', table, columns), rows('d5o-rc7-historical-db', table, columns)
    changes = collections.Counter()
    for key in old.keys() & new.keys():
        for field in old[key].keys() | new[key].keys():
            if old[key].get(field) != new[key].get(field):
                changes[field] += 1
    out.append({'table': table, 'historical_rows': len(old), 'tested_rows': len(new),
                'missing_original_keys': len(old.keys() - new.keys()),
                'changed_fields_on_original_keys': dict(sorted(changes.items()))})
result = {'format': 'd5o-rc13-checkpoint-field-deltas-v1',
          'reference': 'separate restored RC8 post-upgrade checkpoint',
          'tested': 'fresh RC13 177-to-202 upgrade plus fictional actors and Work',
          'values_disclosed': False, 'tables': out}
Path('docs/release/evidence/D5O_RC13_CHECKPOINT_FIELD_DELTAS.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(out))
