"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type WorkType = { key: string; label: string };
type Availability = { available: boolean; versionId: string; versionNumber: number | null;
  workTypes: WorkType[]; error?: string };
export function ConnectedWorkStart({workspace}:{workspace:string}) {
  const [data,setData]=useState<Availability|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [created,setCreated]=useState("");
  const [createdId,setCreatedId]=useState("");
  const confirmationKey=`d5o-connected-work-created:${workspace}`;
  useEffect(()=>{
    const controller=new AbortController();
    const saved=(()=>{
      try {return JSON.parse(sessionStorage.getItem(confirmationKey)??"null") as
        {id?:string;title?:string}|null;}
      catch {try {sessionStorage.removeItem(confirmationKey);}catch {/* Storage unavailable. */}
        return null;}
    })();
    if(!saved?.id||!saved.title)return ()=>controller.abort();
    const {id,title}=saved;
    void fetch(`/api/d5o-hosted/customer-work?workspace=${encodeURIComponent(workspace)}`+
      `&workId=${encodeURIComponent(id)}`,{cache:"no-store",signal:controller.signal})
      .then(async(response)=>response.ok?await response.json() as
        {record?:{id?:string;title?:string}}:null)
      .then((body)=>{
        if(controller.signal.aborted||sessionStorage.getItem(confirmationKey)!==JSON.stringify({id,title}))return;
        if(body?.record?.id===id&&body.record.title===title){setCreated(title);setCreatedId(id);}
        else sessionStorage.removeItem(confirmationKey);
      }).catch(()=>{/* The confirmed message can be checked again on a later visit. */});
    return ()=>controller.abort();
  },[workspace,confirmationKey]);
  useEffect(()=>{const controller=new AbortController();
    void fetch(`/api/d5o-hosted/connected-work?workspace=${encodeURIComponent(workspace)}`,
      {cache:"no-store",signal:controller.signal}).then(async(response)=>{
      const body=await response.json() as Availability;
      if(!response.ok)throw Error(body.error??"Availability could not be loaded");
      setData(body);
    }).catch((cause)=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Unavailable");});
    return()=>controller.abort();},[workspace]);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!data?.available||busy)return;
    const form=event.currentTarget;
    const fields=new FormData(form);
    setBusy(true);setError("");setCreated("");setCreatedId("");
    try {sessionStorage.removeItem(confirmationKey);}catch {/* Storage is optional. */}
    try {
      const response=await fetch(`/api/d5o-hosted/connected-work?workspace=${encodeURIComponent(workspace)}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({commandId:crypto.randomUUID(),configurationVersionId:data.versionId,
          workTypeKey:String(fields.get("workTypeKey")),title:String(fields.get("title")),
          customer:String(fields.get("customer")),site:String(fields.get("site")),
          owner:String(fields.get("owner")),initialDiscovery:{source:String(fields.get("source")),
            need:String(fields.get("need")),procurement:String(fields.get("procurement")),closeDate:""}})});
      const body=await response.json() as {error?:string;result?:{presentationId?:string}};
      if(!response.ok)throw Error(body.error??"Connected Work could not be created");
      const id=body.result?.presentationId;
      if(!id)throw Error("Connected Work response omitted its identifier");
      const title=String(fields.get("title"));
      try {sessionStorage.setItem(confirmationKey,JSON.stringify({id,title}));}
      catch {/* Immediate confirmation remains available without storage. */}
      form.reset();setCreated(title);setCreatedId(id);
    }catch(cause){setError(cause instanceof Error?cause.message:"Command failed");}
    finally{setBusy(false);}
  }
  return <section className="d5o-publication"><header><div><h2>Start connected Work</h2>
    <span>One Work Record, pinned to the active published configuration.</span></div></header>
    {!data&&!error&&<p role="status">Loading tenant capability and Work Types…</p>}
    {error&&<p role="alert">{error}</p>}
    {data&&!data.available&&<p role="status">Connected Work is unavailable for this organization. Contact your D5O platform administrator.</p>}
    {data?.available&&<><p>Published configuration v{data.versionNumber ?? "unknown"} · Required Discover details are checked by the server.</p>
      <form className="connectedStartForm" onSubmit={(event)=>void submit(event)}>
        <label>Work Type<select name="workTypeKey" required>{data.workTypes.map((item)=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label>Work name<input name="title" required maxLength={240} /></label>
        <label>Customer<input name="customer" required maxLength={200} /></label>
        <label>Site<input name="site" required maxLength={200} /></label>
        <label>Accountable owner<input name="owner" required maxLength={120} /></label>
        <label>Demand source<input name="source" required maxLength={120} /></label>
        <label className="connectedStartWide">Customer need<textarea name="need" required maxLength={3000} rows={4} /></label>
        <label>Procurement route<input name="procurement" required maxLength={120} /></label>
        <button disabled={busy||!data.workTypes.length}>{busy?"Creating Work…":"Create connected Work"}</button>
      </form>
      {created&&<p role="status">Connected Work created: {created}{createdId &&
        workspace !== "rybex" && workspace !== "rotork" ? <> · <Link href={`/work/customer/${encodeURIComponent(workspace)}?work=${encodeURIComponent(createdId)}`}>Open Work lifecycle</Link></> : null}</p>}
    </>}
  </section>;
}
