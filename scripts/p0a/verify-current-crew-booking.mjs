import assert from "node:assert/strict";
import { currentCrewBooking } from "../../lib/d5o/hosted/current-crew-booking.ts";

const old = { id: "booking-1", workId: "work-1", packageId: "package-1",
  date: "2026-11-11", shift: "08:00-16:00", week: 2 };
const corrected = { ...old, date: "2026-10-30", week: 0 };
const oldPublication = { id: "publication-1", week: 2, assignments: [old] };
const slot = { date: corrected.date, shift: corrected.shift };

const held = currentCrewBooking([old], [oldPublication], "work-1", "package-1", slot);
assert.equal(held.current, undefined);
assert.equal(held.prior?.id, old.id);
assert.equal(held.activePriorPublication?.id, oldPublication.id);

const moved = currentCrewBooking([corrected], [oldPublication], "work-1", "package-1", slot);
assert.equal(moved.current?.date, slot.date);
assert.equal(moved.published, undefined, "an old publication cannot authorize a corrected date");
assert.equal(moved.activePriorPublication?.week, 2);

const withdrawn = currentCrewBooking([corrected], [oldPublication,
  { id: "publication-2", week: 2, assignments: [] }], "work-1", "package-1", slot);
assert.equal(withdrawn.activePriorPublication, undefined);

const currentPublication = { id: "publication-3", week: 0, assignments: [corrected] };
const published = currentCrewBooking([corrected], [oldPublication,
  { id: "publication-2", week: 2, assignments: [] }, currentPublication],
"work-1", "package-1", slot);
assert.equal(published.published?.id, currentPublication.id);
assert.equal(published.activePriorPublication, undefined);

const retracted = currentCrewBooking([corrected], [currentPublication,
  { id: "publication-4", week: 0, assignments: [] }], "work-1", "package-1", slot);
assert.equal(retracted.published, undefined, "a withdrawn current week is not published");

console.log("PASS: corrected booking requires the current dated publication and supersedes the old week");
