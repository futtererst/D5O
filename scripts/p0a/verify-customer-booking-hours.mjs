import assert from "node:assert/strict";
import { personHoursForShift } from "../../lib/d5o/hosted/booking-hours.ts";

assert.equal(personHoursForShift("08:00-16:00"), 7.5);
assert.equal(personHoursForShift("20:00-04:00"), 7.5);
assert.equal(personHoursForShift("08:00-12:00"), 4);
assert.equal(personHoursForShift("08:00-08:00"), 0);
assert.equal(personHoursForShift("Day shift"), 0);
assert.equal(personHoursForShift("25:00-26:00"), 0);
console.log("PASS: customer booking hours use the dated shift, including overnight work");
