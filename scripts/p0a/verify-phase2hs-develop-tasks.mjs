import assert from "node:assert/strict";
import { developTasks } from "../../lib/d5o/hosted/customer-work-tasks.ts";

const work={id:"work-a",design:{authorityRevision:7,releases:[{
  id:"release-a",packageId:"package-a",status:"Accepted"}]}};
const schedule={assignments:[],publications:[],receipts:[]};
assert.equal(developTasks([{id:"work-a"}],"operations_leader",schedule).length,0);
assert.equal(developTasks([work],"field_worker",schedule).length,0);
assert.equal(developTasks([work],"operations_leader",schedule)[0]?.action,"save-booking");
const booked={...schedule,assignments:[{id:"booking-a",workId:"work-a",packageId:"package-a"}]};
assert.equal(developTasks([work],"operations_leader",booked)[0]?.action,"publish-week");
const published={...booked,publications:[{id:"publication-a",assignments:[{id:"booking-a"}]}]};
assert.equal(developTasks([work],"operations_leader",published)[0]?.action,"await-acknowledgment");
assert.equal(developTasks([work],"operations_leader",published)[0]?.status,"view_only");
const acknowledged={...published,receipts:[{assignmentId:"booking-a",
  publicationId:"publication-a",response:"acknowledged"}]};
assert.equal(developTasks([work],"operations_leader",acknowledged)[0]?.action,"authorize-start");
assert.equal(developTasks([work],"project_manager",acknowledged).length,0,
  "field-start authority belongs to Operations");
const permitted={...work,deploy:{permits:[{packageId:"package-a",status:"Authorized"}]}};
assert.equal(developTasks([permitted],"operations_leader",acknowledged).length,0,
  "authorized Work must leave the actionable Develop queue");
const other={...work,id:"work-b"};
assert.equal(developTasks([other],"operations_leader",acknowledged)[0]?.action,"save-booking",
  "another Work's booking cannot satisfy this Work");
console.log(JSON.stringify({suite:"phase2hs-develop-tasks",passed:10}));
