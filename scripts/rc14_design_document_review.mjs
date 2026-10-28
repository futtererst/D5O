// Actual authenticated Design document review on fictional Work only.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
const ids=JSON.parse(readFileSync('.rc14-design-ids.json','utf8'));
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
const {data:receipt,error}=await admin.rpc('d5o_hosted_design_document_evidence_read_v1',{
  p_workspace_key:'rybex',p_presentation_id:work.id,p_document_id:ids.documentId,p_document_revision:1});
if(error||!receipt?.evidenceId)throw Error(`fictional evidence receipt absent:${error?.code??'none'}`);
async function state(){const r=await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,
  {headers:{cookie:actors.rybex_pm.cookie}});const b=await r.json();
  const record=b.state?.records?.find(x=>x.id===work.id);if(r.status!==200||!record)throw Error('fictional Work unavailable');
  return {revision:b.revision,record};}
async function command(actor,action,note){const current=await state();
  const r=await fetch(`${base}/api/d5o-hosted/prototype-design-command?workspace=rybex`,{
    method:'POST',headers:{cookie:actors[actor].cookie,origin:base,
      'sec-fetch-site':'same-origin','content-type':'application/json'},
    body:JSON.stringify({workId:work.id,action,commandId:randomUUID(),expectedRevision:current.revision,
      expectedDecisionRevision:current.record.design?.authorityRevision??0,
      documentId:ids.documentId,documentRevision:1,evidenceId:receipt.evidenceId,note})});
  const b=await r.json();return {actor,action,http:r.status,error:b.error??null,authoritative:b.synthetic===false};}
const operations=[];
for(const [actor,action,note] of [
  ['rybex_pm','submit-document','Fictional controlled document submitted'],
  ['rybex_ops','approve-document','Independent fictional method review'],
  ['rybex_pm','issue-document','Fictional approved document issued for use']]){
  const result=await command(actor,action,note);operations.push(result);if(result.http!==200)break;
}
const final=await state();
const output={format:'d5o-rc14-design-document-review-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,operations,
  finalDocumentStatus:final.record.design?.documents?.find(d=>d.id===ids.documentId)?.status??null};
writeFileSync('docs/release/evidence/D5O_RC14_DESIGN_DOCUMENT_REVIEW.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));
