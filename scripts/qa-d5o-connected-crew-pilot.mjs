import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !key || !file) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const identity = users.find((item) => item.key === name);
  if (!identity) throw new Error(`pilot_user_missing:${name}`);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: identity.email, password: identity.password });
  if (error) throw error;
  return client;
};
const pm = await login("pm");
const workers = [await login("worker"), await login("worker2")];
const read = async (client, functionName = "d5o_hosted_prototype_read_v1") => {
  const { data, error } = await client.rpc(functionName,
    functionName === "d5o_hosted_prototype_read_v1"
      ? { p_workspace_key: "rybex", p_state_key: "schedule" }
      : { p_workspace_key: "rybex" });
  if (error) throw error;
  return data;
};
let schedule = await read(pm);
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const anchor = Date.parse(`${schedule.state.anchorDate}T00:00:00Z`);
const week = Math.round((Date.parse("2026-10-26T00:00:00Z") - anchor) / 604800000);
const send = async (client, action, input, commandId) => {
  const { data, error } = await client.rpc("d5o_hosted_crew_command_v1", {
    p_workspace_key: "rybex", p_action: action, p_input: input,
    p_command_id: commandId,p_expected_revision: schedule.revision
  });
  if (error) throw new Error(`${action}:${error.code}:${error.message}`);
  schedule = await read(pm);
  return data;
};
const { data: workRead, error: workError } = await pm.rpc(
  "d5o_hosted_prototype_read_v1", { p_workspace_key: "rybex", p_state_key: "work" });
if (workError) throw workError;
const work = workRead.state.records.find((item) => item.id === id);
if (work.design.releases.filter((item) => item.status === "Accepted").length !== 2)
  throw new Error("accepted_two_package_release_required");
for (const [index, pkg] of work.design.packages.entries()) {
  const date = `2026-10-${26 + index}`;
  const bookingId = `pilot-booking-${index + 1}`;
  if (!schedule.state.assignments.some((item) => item.id === bookingId))
    await send(pm, "save-booking", { assignment: {
      id: bookingId, crew: "Pilot fiber crew", people: ["Nate Walker", "Avery Reed"],
      workId: id, packageId: pkg.packageId, week, day: index,
      date, shift: "07:00–15:00"
    } }, `connected-pilot-booking-${index + 1}-v1`);
}
let publication = schedule.state.publications.filter((item) => item.week === week).at(-1);
if (!publication) {
  await send(pm, "publish-week", { week }, "connected-pilot-publish-week-v1");
  publication = schedule.state.publications.filter((item) => item.week === week).at(-1);
}
if (!publication || publication.assignments.length !== 2)
  throw new Error("two_booking_publication_missing");
for (const [index, worker] of workers.entries()) {
  const workerView = await read(worker, "d5o_hosted_worker_schedule_read_v1");
  if (workerView.state.publications.some((entry) => entry.assignments.some(
    (assignment) => !assignment.people.includes(index === 0 ? "Nate Walker" : "Avery Reed"))))
    throw new Error("worker_schedule_leaked_other_booking");
  for (const booking of publication.assignments) {
    const person = index === 0 ? "Nate Walker" : "Avery Reed";
    if (schedule.state.receipts.some((item) => item.publicationId === publication.id
      && item.assignmentId === booking.id && item.recipient === person)) continue;
    await send(worker, "respond-booking", { publicationId: publication.id,
      assignmentId: booking.id, response: "acknowledged" },
    `connected-pilot-${person.replaceAll(" ", "-")}-${booking.id}-response-v1`);
  }
}
const final = await read(pm);
if (final.state.receipts.filter((item) => item.publicationId === publication.id
  && item.response === "acknowledged").length !== 4)
  throw new Error("four_worker_responses_required");
console.log(JSON.stringify({ status: "two_packages_booked_published_acknowledged",
  packageBookings: 2, independentlyAuthenticatedWorkers: 2,
  exactPublicationId: publication.id, workerResponses: 4 }));
