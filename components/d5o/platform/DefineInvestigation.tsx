"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import type { DefinitionRecord, DiscoverContact } from "./work-types";
import styles from "./DefineWorkspace.module.css";

type Project = NonNullable<DefinitionRecord["project"]>;
type Finding = NonNullable<DefinitionRecord["findings"]>[number];
type Clarification = NonNullable<DefinitionRecord["clarifications"]>[number];

export function DefineInvestigation({ definition, contacts, actor, locked, onProjectSave, onFinding, onClarification, onAnswer, onEvidence }: {
  definition: DefinitionRecord;
  contacts: DiscoverContact[];
  actor: string;
  locked: boolean;
  onProjectSave: (project: Project) => void;
  onFinding: (finding: Finding) => void;
  onClarification: (clarification: Clarification) => void;
  onAnswer: (id: string, answer: string, source: string) => void;
  onEvidence: () => void;
}) {
  const project = definition.project;
  const findings = definition.findings ?? [];
  const clarifications = definition.clarifications ?? [];
  const [drawer, setDrawer] = useState<{ kind: "project" | "finding" | "question" | "answer"; id?: string } | null>(null);
  const [projectDraft, setProjectDraft] = useState<Project>({ customerContact: "", siteArea: "", affectedSystems: "", accessConstraints: "", requiredDate: "", ...project });

  function addFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const detail = String(data.get("detail") ?? "").trim();
    const source = String(data.get("source") ?? "").trim();
    if (!detail || !source) return;
    onFinding({ id: crypto.randomUUID(), kind: String(data.get("kind")) as Finding["kind"], status: String(data.get("status")) as Finding["status"], detail, source, author: actor, at: new Date().toISOString() });
    form.reset();
    setDrawer(null);
  }

  function addClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const question = String(data.get("question") ?? "").trim();
    const owner = String(data.get("owner") ?? "").trim();
    const due = String(data.get("due") ?? "");
    if (!question || !owner || !due) return;
    onClarification({ id: crypto.randomUUID(), question, owner, due, answer: "", source: "", status: "Open", openedAt: new Date().toISOString() });
    form.reset();
    setDrawer(null);
  }

  function answerQuestion(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const answer = String(data.get("answer") ?? "").trim();
    const source = String(data.get("source") ?? "").trim();
    if (answer && source) { onAnswer(id, answer, source); setDrawer(null); }
  }

  return <div className={styles.investigation}>
    <div className={styles.intro}><p className={styles.kicker}>PROJECT INVESTIGATION</p><h3>Establish the facts before fixing scope</h3><p>Record what the customer and site require. Keep unanswered points assigned; a reference is not an uploaded or verified file.</p></div>
    <section className={styles.investigationPanel} aria-label="Project context">
      <header><div><h4>Customer and site context</h4><p className={styles.investigationEmpty}>{locked ? "This approved or submitted revision is read only. Start a controlled correction to change it." : "Check the information from Discover, update what the site investigation found, then save these facts for scope review."}</p></div><span>{projectDraft.customerContactId ? "Linked Discover contact" : "Contact to confirm"}</span></header>
      {locked ? <div className={styles.investigationFields}><div><strong>Customer contact</strong><p>{project?.customerContact || "Not recorded"}</p></div><div><strong>Site and affected area</strong><p>{project?.siteArea || "Not recorded"}</p></div><div><strong>Affected systems</strong><p>{project?.affectedSystems || "Not recorded"}</p></div><div><strong>Access constraints</strong><p>{project?.accessConstraints || "Not recorded"}</p></div><div><strong>Required date</strong><p>{project?.requiredDate || "Not recorded"}</p></div></div>
        : <form className={styles.investigationEdit} onSubmit={(event) => { event.preventDefault(); onProjectSave(projectDraft); }}>
          {contacts.length ? <label>Discover contact<select value={projectDraft.customerContactId ?? ""} onChange={(event) => { const contact = contacts.find((item) => item.id === event.target.value); setProjectDraft({ ...projectDraft, customerContactId: contact?.id, customerContact: contact?.name ?? projectDraft.customerContact }); }}><option value="">Choose a linked contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.role}</option>)}</select></label> : null}
          <label>Customer contact<input value={projectDraft.customerContact} onChange={(event) => setProjectDraft({ ...projectDraft, customerContact: event.target.value, customerContactId: undefined })} placeholder="Who can confirm the work?" required /></label>
          <label>Site and affected area<input value={projectDraft.siteArea} onChange={(event) => setProjectDraft({ ...projectDraft, siteArea: event.target.value })} placeholder="Building, room, route or system area" required /></label>
          <label>Affected systems<input value={projectDraft.affectedSystems} onChange={(event) => setProjectDraft({ ...projectDraft, affectedSystems: event.target.value })} placeholder="Systems, equipment or assets in scope" required /></label>
          <label>Access and operating constraints<input value={projectDraft.accessConstraints} onChange={(event) => setProjectDraft({ ...projectDraft, accessConstraints: event.target.value })} placeholder="Escort, permit or outage conditions" required /></label>
          <label>Customer required date<input type="date" value={projectDraft.requiredDate} onChange={(event) => setProjectDraft({ ...projectDraft, requiredDate: event.target.value })} /></label>
          <div className={styles.investigationEditActions}><span>These are editable draft facts. A separate reviewer decides whether the definition can advance.</span><button type="submit" className="d5o-primary">Save investigation facts</button></div>
        </form>}
    </section>
    <section className={styles.investigationPanel} aria-label="Project findings">
      <header><h4>Findings and source records</h4><span>{findings.length} recorded</span></header>
      {findings.map((item) => <article className={styles.investigationRow} key={item.id}><strong>{item.status ?? "Provisional"} · {item.kind}</strong><p>{item.detail}</p><small>Source reference: {item.source} · {item.author} · {new Date(item.at).toLocaleDateString()}</small></article>)}
      {!findings.length ? <p className={styles.investigationEmpty}>No investigation findings have been recorded.</p> : null}
      {!locked ? <button type="button" className="d5o-outline" onClick={() => setDrawer({ kind: "finding" })}>+ Add finding</button> : null}
    </section>
    <section className={styles.investigationPanel} aria-label="Project clarifications">
      <header><h4>Questions to resolve</h4><span>{clarifications.filter((item) => item.status === "Open").length} open</span></header>
      {clarifications.map((item) => <article className={styles.investigationRow} key={item.id}><strong>{item.status} · {item.question}</strong><small>Answer owner: {item.owner} · Due {item.due}</small>{item.status === "Answered" ? <p>{item.answer}<br /><small>Answer source: {item.source}</small></p> : !locked ? <button type="button" className="d5o-outline" onClick={() => setDrawer({ kind: "answer", id: item.id })}>Record answer</button> : null}</article>)}
      {!clarifications.length ? <p className={styles.investigationEmpty}>No questions are awaiting an answer.</p> : null}
      {!locked ? <button type="button" className="d5o-outline" onClick={() => setDrawer({ kind: "question" })}>+ Assign question</button> : null}
    </section>
    <section className={styles.investigationPanel} aria-label="Evidence source boundary"><header><h4>Supporting evidence</h4></header><p className={styles.investigationEmpty}>Findings and answers retain source references; they do not claim file custody or scan verification. Open the Work Record evidence controls for proof.</p><button type="button" className="d5o-outline" onClick={onEvidence}>Open Work Record evidence →</button></section>
    {drawer ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawer(null); }}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={drawer.kind === "project" ? "Edit project context" : drawer.kind === "finding" ? "Add investigation finding" : drawer.kind === "question" ? "Assign customer question" : "Record customer answer"}><header><div><p className={styles.kicker}>DEFINE · INVESTIGATION</p><h3>{drawer.kind === "project" ? "Customer and site context" : drawer.kind === "finding" ? "Add investigation finding" : drawer.kind === "question" ? "Assign a customer question" : "Record the answer"}</h3><p>Keep the source visible so the next reviewer can trace the fact.</p></div><button type="button" className="d5o-outline" onClick={() => setDrawer(null)} aria-label="Close drawer">×</button></header>
      {drawer.kind === "project" ? <form className={styles.drawerForm} onSubmit={(event) => { event.preventDefault(); onProjectSave(projectDraft); setDrawer(null); }}>
        {contacts.length ? <label>Linked Discover stakeholder<select disabled={locked} value={projectDraft.customerContactId ?? ""} onChange={(event) => { const contact = contacts.find((item) => item.id === event.target.value); setProjectDraft({ ...projectDraft, customerContactId: contact?.id, customerContact: contact?.name ?? projectDraft.customerContact }); }}><option value="">Provisional contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.role}</option>)}</select></label> : null}
        {(["customerContact", "siteArea", "affectedSystems", "accessConstraints", "requiredDate"] as const).map((key) => <label key={key}>{({ customerContact: "Customer contact or sponsor", siteArea: "Site and affected area", affectedSystems: "Assets and systems", accessConstraints: "Access and operating constraints", requiredDate: "Customer required date" })[key]}<input type={key === "requiredDate" ? "date" : "text"} value={projectDraft[key]} disabled={locked} onChange={(event) => setProjectDraft({ ...projectDraft, [key]: event.target.value, ...(key === "customerContact" ? { customerContactId: undefined } : {}) })} /></label>)}
        {!contacts.length ? <p className={styles.drawerHelp}>This contact is provisional until linked to the customer relationship in Discover.</p> : null}<footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Close</button>{!locked ? <button type="submit" className="d5o-primary">Save context</button> : null}</footer></form> : null}
      {drawer.kind === "finding" ? <form className={styles.drawerForm} onSubmit={addFinding}><label>Finding type<select name="kind"><option>Survey</option><option>Customer input</option><option>Technical review</option><option>Document review</option></select></label><label>Fact status<select name="status"><option>Provisional</option><option>Confirmed</option></select></label><label>What was learned?<textarea name="detail" rows={4} required placeholder="Record the observation or requirement" /></label><label>Source or document reference<input name="source" required placeholder="Meeting date, drawing ID, survey ID or document reference" /></label><p className={styles.drawerHelp}>A reference alone does not upload a file or establish verified evidence.</p><footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Cancel</button><button type="submit" className="d5o-primary">Save finding</button></footer></form> : null}
      {drawer.kind === "question" ? <form className={styles.drawerForm} onSubmit={addClarification}><label>Question<textarea name="question" rows={3} required placeholder="What must be confirmed before scope is agreed?" /></label><label>Answer owner<input name="owner" required placeholder="Named customer or internal owner" /></label><label>Due date<input name="due" type="date" required /></label><footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Cancel</button><button type="submit" className="d5o-primary">Assign question</button></footer></form> : null}
      {drawer.kind === "answer" && drawer.id ? <form className={styles.drawerForm} onSubmit={(event) => answerQuestion(event, drawer.id!)}><label>Answer<textarea name="answer" rows={5} required /></label><label>Answer source<input name="source" required placeholder="Person, meeting or document reference" /></label><footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Cancel</button><button type="submit" className="d5o-primary">Record answer</button></footer></form> : null}
    </aside></div> : null}
  </div>;
}
