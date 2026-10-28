// Compare disposable clean and offline historical definitions without retaining SQL text.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createP0aRuntime, cleanupP0aRuntime } from "./p0a/disposable-runtime.mjs";

const query = `select row_to_json(x)::text from (
 select 'function' kind,n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' key,
 p.prosrc body,pg_get_functiondef(p.oid) definition,null::text qual,null::text check_expr,
 pg_get_function_result(p.oid) return_type,l.lanname language,p.provolatile::text volatility,
 p.proisstrict strict,p.proparallel::text parallel,p.proleakproof leakproof,
 coalesce(array_to_string(p.proconfig,'|'),'') config,
 coalesce(pg_get_expr(p.proargdefaults,0),'') defaults,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
 has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_exec
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_language l on l.oid=p.prolang
 where n.nspname='d5o_hosted' or (n.nspname='public' and p.proname like 'd5o_%')
 union all
 select 'policy',schemaname||'.'||tablename||'.'||policyname,null,null,qual,with_check,
 null,null,null,null,null,null,null,null,null,null,null
 from pg_policies where schemaname='d5o_hosted'
 union all
 select 'constraint',n.nspname||'.'||c.relname||'.'||q.conname,
 pg_get_constraintdef(q.oid,true),null,null,null,
 null,null,null,null,null,null,null,null,null,null,null
 from pg_constraint q join pg_class c on c.oid=q.conrelid
 join pg_namespace n on n.oid=c.relnamespace where n.nspname='d5o_hosted') x`;
function read(container, role) {
  const r=spawnSync('docker',['exec',container,'psql','-U',role,'-d','postgres','-X','-q',
    '-v','ON_ERROR_STOP=1','-At','-c',query],{encoding:'utf8',maxBuffer:12_000_000});
  if(r.status!==0) throw Error('isolated catalog read failed: '+(r.stderr||'').slice(0,200));
  return Object.fromEntries(r.stdout.trim().split(/\r?\n/).filter(Boolean).map(x=>{const row=JSON.parse(x);return [row.key,row]}));
}
function normalize(s) {
  if(s==null) return null;
  let out='', state='normal', space=false, tag='';
  for(let i=0;i<s.length;i++) {
    const c=s[i], next=s[i+1];
    if(state==='line') {if(c==='\n'||c==='\r'){state='normal';space=true;}continue;}
    if(state==='block') {if(c==='*'&&next==='/'){i++;state='normal';space=true;}continue;}
    if(state==='single') {out+=c;if(c==="'"&&next==="'"){out+=next;i++;}else if(c==="'")state='normal';continue;}
    if(state==='double') {out+=c;if(c==='"'&&next==='"'){out+=next;i++;}else if(c==='"')state='normal';continue;}
    if(state==='dollar') {out+=c;if(c==='$'&&s.slice(i-tag.length+1,i+1)===tag)state='normal';continue;}
    if(c==='-'&&next==='-'){state='line';i++;continue;}
    if(c==='/'&&next==='*'){state='block';i++;continue;}
    if(/\s/.test(c)){space=true;continue;}
    if(space&&out)out+=' ';
    space=false;
    if(c==="'"){state='single';out+=c;continue;}
    if(c==='"'){state='double';out+=c;continue;}
    if(c==='$') {const match=s.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if(match){tag=match[0];state='dollar';out+=tag;i+=tag.length-1;continue;}}
    out+=c.toLowerCase();
  }
  return out.trim();
}
let runtime;
try {
  runtime=await createP0aRuntime();
  const clean=read(runtime.dbContainer,'postgres');
  const historical=read('d5o-rc7-historical-db','supabase_admin');
  const results=[];
  for(const key of Object.keys(clean).sort()) {
    const a=clean[key],b=historical[key];
    if(!b){results.push({key,kind:a.kind,presentInHistorical:false});continue;}
    const record={key,kind:a.kind,presentInHistorical:true};
    for(const field of a.kind==='policy'?['qual','check_expr']:
      a.kind==='constraint'?['body']:['body','definition']) {
      record[field+'Exact']=a[field]===b[field];
      record[field+'Normalized']=normalize(a[field])===normalize(b[field]);
    }
    if(a.kind==='policy') {
      record.cleanQual=a.qual;
      record.historicalQual=b.qual;
      record.uidQualifierOnly=normalize(a.qual)?.replaceAll('auth.uid()','uid()')===
        normalize(b.qual)?.replaceAll('auth.uid()','uid()');
    }
    if(a.kind==='constraint' && !record.bodyNormalized) {
      record.cleanDefinition=a.body;
      record.historicalDefinition=b.body;
    }
    if(a.kind==='function') for(const field of ['anon_exec','auth_exec','service_exec',
      'return_type','language','volatility','strict','parallel','leakproof','config','defaults'])
      record[field+'Match']=a[field]===b[field];
    results.push(record);
  }
  const output={format:'d5o-rc19-disposable-effective-sql-v1',cleanLedger:236,
    historicalLedger:202,definitionComparisons:results};
  writeFileSync('docs/release/evidence/D5O_RC19_EFFECTIVE_SQL_COMPARISON.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({functions:results.filter(x=>x.kind==='function').length,
    normalizedBodyDifferences:results.filter(x=>x.kind==='function'&&x.presentInHistorical&&!x.bodyNormalized).length,
    normalizedPolicyDifferences:results.filter(x=>x.kind==='policy'&&x.presentInHistorical&&(!x.qualNormalized||!x.check_exprNormalized)).length,
    normalizedConstraintDifferences:results.filter(x=>x.kind==='constraint'&&x.presentInHistorical&&!x.bodyNormalized).length}));
} finally {if(runtime) console.log(JSON.stringify({cleanup:cleanupP0aRuntime(runtime)}));}
