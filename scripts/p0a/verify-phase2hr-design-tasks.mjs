import assert from "node:assert/strict";
import { designTasks, designReceiptTasks } from "../../lib/d5o/hosted/customer-work-tasks.ts";

const base={id:"work-a",discovery:{designHandoff:{status:"accepted"}}};
assert.equal(designTasks([base],"admin","owner")[0]?.action,"create-package");
assert.equal(designTasks([base],"operations_leader","ops").length,0);
assert.equal(designTasks([{id:"work-a"}],"admin","owner").length,0);
const connected=[{id:"package-a",workId:"work-a"}];
assert.equal(designTasks([base],"admin","owner",connected)[0]?.action,"save-document");
const draft={...base,design:{authorityRevision:1,documents:[{id:"doc-a",status:"Draft"}]}};
assert.equal(designTasks([draft],"admin","owner",connected)[0]?.action,"submit-document");
const submitted=structuredClone(draft);
submitted.design.documents[0].status="In review";
submitted.design.documents[0].submittedByActorId="owner";
assert.equal(designTasks([submitted],"admin","owner",connected).length,0,
  "owner waits for an independent document decision");
assert.equal(designTasks([submitted],"operations_leader","ops",connected)[0]?.action,"approve-document");
const approved=structuredClone(submitted);
approved.design.documents[0].status="Approved";
assert.equal(designTasks([approved],"admin","owner",connected)[0]?.action,"issue-document");
approved.design.documents[0].status="Issued for use";
assert.equal(designTasks([approved],"admin","owner",connected)[0]?.action,"release-package");
const review=structuredClone(approved);
review.design.packages=[{packageId:"package-a",revision:2}];
review.design.reviews=[{id:"review-a",packageId:"package-a",discipline:"Safety",
  revision:2,status:"Requested",requestedByActorId:"owner"}];
assert.equal(designTasks([review],"operations_leader","ops",connected)[0]?.action,"decide-review");
review.design.packages[0].revision=3;
assert.equal(designTasks([review],"operations_leader","ops",connected).length,0,
  "prior package revision review is no longer actionable");
review.design.packages[0].revision=2;
review.design.reviews[0].status="Approved";
review.design.releases=[{id:"release-a",packageId:"package-a",status:"Awaiting receipt",
  issuedByActorId:"owner"}];
assert.equal(designTasks([review],"admin","owner",connected).length,0);
assert.equal(designReceiptTasks([review],"operations_leader","ops")[0]?.action,"respond-receipt");
review.design.releases[0].status="Accepted";
assert.equal(designReceiptTasks([review],"operations_leader","ops").length,0);
console.log(JSON.stringify({suite:"phase2hr-design-tasks",passed:14}));
