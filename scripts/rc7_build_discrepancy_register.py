"""Attach actual retained-SQL evidence and historical probe outcome to 140 RC5 items."""
import json
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
EV=ROOT/'docs/release/evidence'
unresolved=json.loads((EV/'D5O_RC5_UNRESOLVED_DISCREPANCIES.json').read_text())['items']
comp={r['source_version']:r for r in json.loads((EV/'D5O_RC7_RETAINED_SQL_COMPARISON.json').read_text())['rows']}
rows=[]
for item in unresolved:
    key=item['id']
    if key.startswith('HOST-'):
        category='UNMATCHED_HOSTED_HISTORY'
        status='UNRESOLVED'; note='Retained SQL present in protected ledger; no frozen source counterpart. Preserve ledger.'
        source=None
    else:
        source=comp[key.split('-',1)[1]]
        kind=source['retained_sql_comparison']
        if key.startswith('REMAP-'):
            category='VERSION_REMAPPING_WITH_EQUIVALENT_SQL'
            status='HISTORY_MAPPING_UNRESOLVED'; note='SQL line-ending equivalent; hosted version differs from source version.'
        elif kind=='LEXICALLY_EQUIVALENT_COMMENTS_WHITESPACE':
            category='SQL_FORMATTING_DIFFERENCE';status='SQL_TEXT_EQUIVALENT'
            note='Conservative SQL token stream identical after comments and external whitespace are omitted; ledger identity preserved.'
        elif source['hosted_version']:
            category='RETAINED_SQL_DIFFERENCE';status='EFFECT_UNRESOLVED'
            note='Retained SQL differs from source; schema, permissions and data effects require per-object review.'
        elif source['order']<=44:
            category='EARLY_SOURCE_VERSION_ABSENT';status='HISTORICAL_EFFECT_UNRESOLVED'
            note='Hosted legacy SQL and current schema must be mapped to source effects before replay.'
        else:
            category='LATE_SOURCE_VERSION_ABSENT';status='PENDING_DEPENDENCY_BLOCKED'
            note='Pending candidate; transaction probe stopped at source order 215 due historical field-worker invitation.'
    rows.append({'id':key,'source_file':source['source_file'] if source else None,
        'source_version':source['source_version'] if source else None,
        'hosted_version':item.get('hosted_version'), 'category':category,'status':status,
        'retained_sql_comparison':source['retained_sql_comparison'] if source else 'RETAINED_SQL_AVAILABLE_PROTECTED_ONLY',
        'retained_sql_sha256':source['retained_sql_sha256'] if source else None,
        'source_sha256':next((m['sha256'] for m in json.loads((EV/'D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json').read_text())['migrations'] if source and m['version']==source['source_version']),None),
        'finding':note,'evidence':['D5O_RC7_RETAINED_SQL_COMPARISON.json','D5O_RC7_LATE_MIGRATION_PROBE.json']})
assert len(rows)==140
out={'format':'d5o-rc7-discrepancy-register-v1','count':len(rows),
    'categories':dict(Counter(r['category'] for r in rows)),
    'status_counts':dict(Counter(r['status'] for r in rows)),
    'historical_data_blocker':{'source_order':215,'reason':'one completed historical field_worker invitation violates the replacement requested_role CHECK'},
    'items':rows}
(EV/'D5O_RC7_DISCREPANCY_REGISTER.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'count':len(rows),'categories':out['categories']}))
