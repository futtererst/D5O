"use client";

import type { FormEvent } from "react";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { CommercialCommand } from "@/lib/d5o/prototype-work/commercial-command";

const field=(data:FormData,key:string)=>String(data.get(key)??"").trim();

/** Thin employee controls over the existing canonical commercial commands. */
export function CustomerCommercialActions({work,role,busy,onCommand,onSaveInitialOffer}:{
  work:WorkRecord;role:string;busy:boolean;
  onCommand:(command:Omit<CommercialCommand,"expectedRevision">)=>Promise<boolean>;
  onSaveInitialOffer:(input:NonNullable<CommercialCommand["offerInput"]>)=>Promise<void>;
}) {
  const estimate=work.discovery?.estimate;
  const proposal=work.discovery?.proposal;
  const offerRevision=proposal?.package?.revision??0;
  const canPrepare=role==="project_manager"||role==="admin";
  const canReview=role==="operations_leader"||role==="billing_commercial_lead"||role==="admin";
  const run=(action:CommercialCommand["action"],packageRevision:number,
    values:Partial<CommercialCommand>={})=>void onCommand({action,workId:work.id,packageRevision,...values});
  const form=(action:CommercialCommand["action"],packageRevision:number,
    values:(data:FormData)=>Partial<CommercialCommand>)=>(event:FormEvent<HTMLFormElement>)=>{
      event.preventDefault();run(action,packageRevision,values(new FormData(event.currentTarget)));
    };
  return <section aria-label="Connected commercial decisions">
    <h4>Solution, price, offer and customer award</h4>
    <p>Exact Work and revision are checked by the authoritative command. An award records a sourced customer decision; it does not send an invitation or message.</p>
    {canPrepare && estimate?.status==="Draft" && estimate.detailed &&
      <form onSubmit={form("submit-pricing",estimate.revision,(data)=>({dueDate:field(data,"dueDate")}))}>
        <label>Pricing review due<input name="dueDate" type="date" required /></label>
        <button disabled={busy}>Submit revision for pricing review</button>
      </form>}
    {canReview && estimate?.status==="Pricing review" &&
      <form onSubmit={form("approve-pricing",estimate.revision,(data)=>({note:field(data,"note")}))}>
        <label>Independent pricing decision basis<input name="note" minLength={10} required /></label>
        <button disabled={busy}>Approve detailed pricing</button>
      </form>}
    {canPrepare && estimate?.status==="Approved" &&
      ["Not started","Draft","Changes requested"].includes(proposal?.status??"") &&
      <form onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);
        const input={scope:field(data,"scope"),assumptions:field(data,"assumptions"),
          exclusions:field(data,"exclusions"),commercialTerms:field(data,"commercialTerms"),
          changeReason:field(data,"changeReason")};
        if(offerRevision===0)void onSaveInitialOffer(input);
        else run("save-proposal-revision",offerRevision+1,{offerInput:input});}}>
        <label>Customer-facing scope<textarea name="scope" required /></label>
        <label>Assumptions<textarea name="assumptions" /></label>
        <label>Exclusions<textarea name="exclusions" /></label>
        <label>Commercial terms<textarea name="commercialTerms" required /></label>
        {offerRevision>0 && <label>Revision reason<textarea name="changeReason" required /></label>}
        <button disabled={busy}>{offerRevision===0?"Save customer offer draft":"Save customer offer revision"}</button>
      </form>}
    {canPrepare && proposal?.status==="Draft" &&
      <form onSubmit={form("submit-proposal",offerRevision,(data)=>({dueDate:field(data,"dueDate")}))}>
        <label>Offer review due<input name="dueDate" type="date" required /></label>
        <button disabled={busy}>Request independent offer approval</button>
      </form>}
    {canReview && proposal?.status==="Internal review" &&
      <form onSubmit={form("approve-proposal",offerRevision,(data)=>({note:field(data,"note")}))}>
        <label>Independent offer decision basis<input name="note" minLength={10} required /></label>
        <button disabled={busy}>Approve customer offer</button>
      </form>}
    {canPrepare && proposal?.status==="Approved" &&
      <form onSubmit={form("record-customer-submission",offerRevision,(data)=>({
        recipient:field(data,"recipient"),method:field(data,"method"),dueDate:field(data,"dueDate")}))}>
        <label>Customer recipient<input name="recipient" required /></label>
        <label>Submission method<select name="method" defaultValue="Customer portal" required>
          <option>Customer portal</option>
          <option>Email</option>
          <option>Procurement platform</option>
          <option>Direct presentation</option>
        </select></label>
        <label>Customer response due<input name="dueDate" type="date" required /></label>
        <button disabled={busy}>Record exact customer submission</button>
      </form>}
    {canPrepare && proposal?.status==="Submitted" && !work.discovery?.outcome &&
      <form onSubmit={form("record-customer-response",offerRevision,(data)=>({
        responseStatus:"Awarded",receivedAt:field(data,"receivedAt"),
        note:field(data,"note"),sourceReference:field(data,"sourceReference")}))}>
        <label>Customer award date<input name="receivedAt" type="date" required /></label>
        <label>Customer decision basis<textarea name="note" minLength={10} required /></label>
        <label>Customer award source<input name="sourceReference" required /></label>
        <button disabled={busy}>Record sourced customer award</button>
      </form>}
  </section>;
}
