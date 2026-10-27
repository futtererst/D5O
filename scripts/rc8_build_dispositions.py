"""Track all 140 prior discrepancies after the actual isolated RC8 upgrade."""
import json,re
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];EV=ROOT/'docs/release/evidence'
old=json.loads((EV/'D5O_RC7_DISCREPANCY_REGISTER.json').read_text())['items']
corrected={r['source_version']:r for r in json.loads((EV/'D5O_RC8_RETAINED_SQL_COMPARISON_UTF8.json').read_text())['rows']}
upgrade=json.loads((EV/'D5O_RC8_ORDERED_UPGRADE.json').read_text())
applied={r['filename'] for r in upgrade['results'] if r['result']=='APPLIED_AND_RECORDED'}
if len(applied)!=25:raise RuntimeError('25 actual late migrations required')
rows=[]
for r in old:
    category=r['category'];out={k:r[k] for k in ('id','source_file','source_version','hosted_version','category')}
    if category in ('SQL_FORMATTING_DIFFERENCE','RETAINED_SQL_DIFFERENCE','VERSION_REMAPPING_WITH_EQUIVALENT_SQL'):
        kind=corrected[r['source_version']]['retained_sql_comparison']
        if r['hosted_version'] != r['source_version']:
            category='VERSION_REMAPPING_WITH_EQUIVALENT_SQL'
        else:
            category='SQL_FORMATTING_DIFFERENCE' if kind in ('LEXICALLY_EQUIVALENT_COMMENTS_WHITESPACE','LINE_ENDINGS_ONLY','EXACT_BYTES') else 'RETAINED_SQL_DIFFERENCE'
        out['category']=category
        out['utf8_sql_comparison']=kind
    if category=='LATE_SOURCE_VERSION_ABSENT':
        if r['source_file'] not in applied:raise RuntimeError('pending source file not actually applied')
        out.update(status='ACTUALLY_APPLIED_LOCAL_ONLY',release_risk='PENDING_PRODUCTION',
          disposition='Actual frozen SQL executed and recorded in isolated ledger; no production execution.')
    elif category=='SQL_FORMATTING_DIFFERENCE':
        out.update(status='SQL_TEXT_EQUIVALENT',release_risk='LOW',
          disposition='UTF-8 retained SQL token stream, including dollar bodies and operator runs, matches source after comments and external whitespace are omitted; retain hosted history.')
    elif category=='RETAINED_SQL_DIFFERENCE':
        high=bool(re.search(r'authority|security|role|rls|admin|private|evidence|worker|work|configuration|field|labor|cost|finance|billing|schedule|design|publication',r['source_file'] or '',re.I))
        out.update(status='EFFECT_EQUIVALENCE_UNPROVEN',release_risk='HIGH' if high else 'UNKNOWN',
          disposition='No execution collision in 25-file local upgrade; retained SQL/object, grant/RLS and data-effect difference still requires review.')
    elif category=='EARLY_SOURCE_VERSION_ABSENT':
        out.update(status='HISTORICAL_EFFECT_UNPROVEN',release_risk='UNKNOWN',
          disposition='Do not replay or invent a hosted version; map legacy effect to source requirement.')
    elif category=='VERSION_REMAPPING_WITH_EQUIVALENT_SQL':
        out.update(status='SQL_EQUIVALENT_VERSION_MAPPING_UNRESOLVED',release_risk='HIGH',
          disposition='SQL exact, line-ending, or operator-sensitive token equivalent; preserve hosted version and define version-aware deployment behavior without ledger fabrication.')
    else:
        out.update(status='LEGACY_HOSTED_EFFECT_UNPROVEN',release_risk='UNKNOWN',
          disposition='Preserve hosted ledger and map retained SQL effects before production decision.')
    rows.append(out)
result={'format':'d5o-rc8-discrepancy-dispositions-v1','count':len(rows),
  'status_counts':dict(Counter(r['status'] for r in rows)),
  'interpretation':'Actual late SQL execution does not prove earlier historical/effective-schema equivalence.',
  'items':rows}
assert len(rows)==140
(EV/'D5O_RC8_DISCREPANCY_DISPOSITIONS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result['status_counts']))
