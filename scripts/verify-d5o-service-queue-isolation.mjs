import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
if(process.env.D5O_QUEUE_TARGET_URL!=='http://127.0.0.1:56821')throw new Error('disposable_only');
const users=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,'utf8')).users;
async function read(key,workspace='rybex'){
 const user=users.find(u=>u.key===key);if(!user)throw new Error(`missing_${key}`);
 const client=createClient(process.env.D5O_QUEUE_TARGET_URL,process.env.D5O_QUEUE_ANON);
 const signed=await client.auth.signInWithPassword({email:user.email,password:user.password});
 if(signed.error)throw signed.error;
 const result=await client.rpc('d5o_hosted_service_actions_v1',{p_workspace_key:workspace});
 return {data:result.data,error:result.error?.code};
}
const pm=await read('pm'),finance=await read('finance'),worker=await read('worker'),south=await read('pm','rotork');
if(pm.error||!pm.data?.some(a=>a.kind==='Service Finance reassessment'&&a.actionable))throw new Error('pm_queue_mismatch');
if(finance.error||!finance.data?.some(a=>a.kind==='Service Finance reassessment'&&!a.actionable))throw new Error('finance_waiting_mismatch');
if(worker.error||worker.data?.length)throw new Error('worker_queue_leak');
if(south.error!=='42501')throw new Error(`cross_tenant_mismatch:${south.error}:${JSON.stringify(south.data?.map(a=>a.kind))}`);
console.log(JSON.stringify({pm:'actionable reassessment',finance:'waiting on project manager',worker:'no service Finance data',crossTenant:south.error}));
