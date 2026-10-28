// Fictional initial offer fixture, followed by genuine-session authoritative review and award.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
async function state(){
  const response=await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,{headers:{cookie:actors.rybex_pm.cookie}});
  const body=await response.json(), record=body.state?.records?.find(r=>r.id===work.id&&r.canonicalWorkId===work.canonicalWorkId);
  if(response.status!==200||!record)throw Error('fictional Work unavailable');
  return {revision:body.revision,state:body.state,record};
}
async function post(actor,path,input){
  const response=await fetch(base+path,{method:'POST',headers:{cookie:actors[actor].cookie,origin:base,
    'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify(input)});
  const body=await response.json();return {http:response.status,error:body.error??null,authoritative:body.synthetic===false};
}
const before=await state(), estimate=before.record.discovery?.estimate;
if(estimate?.status!=='Approved')throw Error('fictional estimate approval absent');
const offer={revision:1,estimateRevision:estimate.revision,scope:'Inspect and repair fictional service component',
  assumptions:'Fictional customer confirms escorted access',exclusions:'Unrelated equipment and systems',
  commercialTerms:'Synthetic qualification only',sellPrice:estimate.sellPrice,preparedAt:new Date().toISOString(),
  definitionSource:estimate.definitionSource,pricingBasis:{policyId:estimate.detailed.evaluation.policyId,
    policyVersion:estimate.detailed.evaluation.policyVersion,solutionRevision:estimate.detailed.input.solutionRevision,
    currency:estimate.detailed.input.currency,includedCostMinor:estimate.detailed.evaluation.includedCostMinor,
    priceMinor:estimate.detailed.evaluation.proposedPriceMinor}};
const next={...before.state,revision:before.revision+1,records:before.state.records.map(r=>r.id===work.id?
  {...r,discovery:{...r.discovery,proposal:{...r.discovery.proposal,status:'Draft',package:offer,packageHistory:[offer]}}}:r)};
const fixture=await post('rybex_pm','/api/d5o-hosted/prototype-state?workspace=rybex',
  {workspace:'rybex',key:'work',expectedRevision:before.revision,state:next});
const operations=[];
if(fixture.http===200){
  const steps=[
    ['rybex_pm','submit-proposal',0,{dueDate:'2026-12-01'}],
    ['rybex_ops','approve-proposal',1,{note:'Independent fictional offer and price review'}],
    ['rybex_pm','record-customer-submission',2,{recipient:'Fictional customer buyer',method:'Customer portal',dueDate:'2026-12-01'}],
    ['rybex_ops','record-customer-response',3,{responseStatus:'Awarded',receivedAt:'2026-10-28',
      note:'Synthetic buyer awards the exact reviewed fictional service offer',sourceReference:'SYNTHETIC-RC14-AWARD'}],
    ['rybex_pm','submit-design-handoff',0,{dueDate:'2026-12-01',handoffRevision:1}],
    ['rybex_ops','accept-design-handoff',1,{note:'Independently received the exact fictional award',handoffRevision:1}]
  ];
  for(const [actor,action,decision,extra] of steps){
    const current=await state();
    const result=await post(actor,'/api/d5o-hosted/prototype-commercial-command?workspace=rybex',
      {workId:work.id,action,commandId:randomUUID(),expectedRevision:current.revision,
        expectedDecisionRevision:decision,packageRevision:1,...extra});
    operations.push({actor,action,...result});if(result.http!==200)break;
  }
}
const after=await state();
const output={format:'d5o-rc14-offer-award-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,initialOfferFixtureHttp:fixture.http,
  initialOfferFixtureError:fixture.error,operations,finalOutcome:after.record.discovery?.outcome??null,
  designHandoff:after.record.discovery?.designHandoff?.status??null};
writeFileSync('docs/release/evidence/D5O_RC14_OFFER_AWARD_HTTP.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));
