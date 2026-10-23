import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321" || !key || !file)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const user = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
};
const [pm, quality, operations] = await Promise.all([
  login("pm"), login("quality"), login("operations")
]);
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async () => {
  const { data, error } = await pm.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  if (error) throw error;
  return { source: data, work: data.state.records.find((item) => item.id === id) };
};
const send = async (client, packageId, action, input, commandId) => {
  const { source, work } = await read();
  return client.rpc("d5o_hosted_acceptance_command_v1", {
    p_workspace_key: "rybex",p_presentation_id: id,p_package_id: packageId,
    p_action: action,p_input: input,p_command_id: commandId,
    p_expected_source_revision: source.revision,
    p_expected_design_revision: work.design.authorityRevision,
    p_expected_deploy_revision: work.deploy.authorityRevision
  });
};
const success = ({ error }, label) => { if (error) throw new Error(`${label}:${error.code}:${error.message}`); };
const first = (await read()).work;
const [north, south] = first.design.packages.map((item) => item.packageId);
const premature = await send(quality, south, "accept-client", {
  turnoverId: "missing", signerName: "Synthetic Client Representative",
  signerOrganization: "Synthetic Review Customer",
  authorityBasis: "Isolated fictional customer review role",
  source: "SYNTHETIC-PILOT-NOT-A-REAL-CUSTOMER-ACCEPTANCE"
}, "connected-premature-acceptance-denied-v1");
if (!premature.error) throw new Error("premature_acceptance_not_blocked");
for (const [index, packageId] of [north, south].entries()) {
  let current = (await read()).work;
  let turnover = current.deploy.turnovers.find((item) => item.packageId === packageId);
  if (!turnover) {
    success(await send(pm, packageId, "assemble-turnover", {
      operateOwner: "Pilot Operations Receiver",
      obligations: "Synthetic warranty and service intake review required"
    }, `connected-turnover-assemble-${index}-v1`), `turnover_assemble_${index}`);
    current = (await read()).work;
    turnover = current.deploy.turnovers.find((item) => item.packageId === packageId);
  }
  if (turnover.status === "Draft") {
    const selfReview = await send(pm, packageId, "accept-client", {
      turnoverId: turnover.id,signerName: "Synthetic Client Representative",
      signerOrganization: "Synthetic Review Customer",
      authorityBasis: "Isolated fictional customer review role",
      source: `SYNTHETIC-PILOT-PACKAGE-${index}-NOT-REAL-ACCEPTANCE`
    }, `connected-self-acceptance-denied-${index}-v1`);
    if (!selfReview.error || selfReview.error.code !== "42501")
      throw new Error(`self_acceptance_not_blocked_${index}`);
    success(await send(quality, packageId, "accept-client", {
      turnoverId: turnover.id,signerName: "Synthetic Client Representative",
      signerOrganization: "Synthetic Review Customer",
      authorityBasis: "Isolated fictional customer review role",
      source: `SYNTHETIC-PILOT-PACKAGE-${index}-NOT-REAL-ACCEPTANCE`
    }, `connected-package-acceptance-${index}-v1`), `package_accept_${index}`);
  }
  current = (await read()).work;
  turnover = current.deploy.turnovers.find((item) => item.id === turnover.id);
  if (turnover.receipt === "Awaiting") success(await send(operations, packageId, "respond-operate", {
    turnoverId: turnover.id,decision: "Accepted",
    note: "Independent Operations receipt of the exact pilot package turnover"
  }, `connected-package-receipt-${index}-v1`), `package_receipt_${index}`);
}
let current = (await read()).work;
if (!current.deploy.workAcceptance) success(await send(quality, "", "accept-work", {
  signerName: "Synthetic Client Representative",
  signerOrganization: "Synthetic Review Customer",signerRole: "Pilot site reviewer",
  authorityBasis: "Isolated fictional customer review role",
  source: "SYNTHETIC-PILOT-WHOLE-WORK-NOT-REAL-ACCEPTANCE"
}, "connected-whole-work-acceptance-v1"), "whole_work_acceptance");
current = (await read()).work;
if (current.deploy.workAcceptance.receipt === "Awaiting") {
  const selfReceipt = await send(quality, "", "respond-operate-work", {
    decision: "Accepted",note: "Receiving owner independently accepts the exact turnover"
  }, "connected-self-work-receipt-denied-v1");
  if (!selfReceipt.error || selfReceipt.error.code !== "42501")
    throw new Error("self_work_receipt_not_blocked");
  success(await send(operations, "", "respond-operate-work", {
    decision: "Accepted",note: "Independent Operations receipt of the exact whole-work turnover"
  }, "connected-work-operate-receipt-v1"), "work_operate_receipt");
}
const final = (await read()).work;
if (final.deploy.turnovers.length !== 2
  || final.deploy.turnovers.some((item) => item.status !== "Client accepted" || item.receipt !== "Accepted")
  || final.deploy.workAcceptance.receipt !== "Accepted") throw new Error("acceptance_or_receipt_missing");
console.log(JSON.stringify({ status: "two_package_pilot_acceptance_and_operate_receipt",
  customerSource: "synthetic_fictional_not_real_customer_authority",
  packageTurnovers: 2, wholeWork: "Accepted", operateReceipt: "Accepted" }));
