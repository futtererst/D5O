import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_QUEUE_TARGET_URL !== "http://127.0.0.1:56821" ||
  process.env.D5O_QUEUE_ORIGIN !== "http://127.0.0.1:61645")
  throw new Error("disposable_invoice_fixture_only");
const users=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users;
const origin=process.env.D5O_QUEUE_ORIGIN, requestId="abe94af3-bdc5-435b-b6ad-ca810293988e";
const browser=await chromium.launch({headless:true});
async function role(key) {
  const user=users.find(item=>item.key===key), context=await browser.newContext(), page=await context.newPage();
  await page.goto(origin+"/auth/sign-in?next="+encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button",{name:"Continue to your work"}).click();
  await page.getByRole("heading",{name:"Actions requiring attention"}).waitFor({timeout:60000});
  return {context,page};
}
async function open(session,kind) {
  await session.page.goto(origin+"/work?workspace=rybex&view=my-work");
  const queue=session.page.locator('section[aria-label="Service commercial and Finance actions"]');
  await queue.getByRole("link",{name:new RegExp("Synthetic monitoring route fault · "+kind)}).click();
  if(!session.page.url().includes("request="+requestId))throw Error("wrong_request_link");
  const panel=session.page.locator('section[aria-label="Service invoice and receivable"]');
  await panel.getByText(/Approved uncovered/).waitFor();
  return panel;
}
async function act(page,form,button) {
  const [r]=await Promise.all([
    page.waitForResponse(x=>x.url().includes("/service-invoice")&&x.request().method()==="POST"),
    form.getByRole("button",{name:button}).click()
  ]);
  const body=await r.json();
  if(!r.ok())throw Error(button+":"+r.status()+":"+body.error);
  return body;
}
try {
  const pm=await role("pm");
  let panel=await open(pm,"Service invoice drafting");
  let form=panel.locator("form").filter({hasText:"Draft exact approved uncovered amount"});
  await form.locator('input[name="note"]').fill("Fictional USD 524.65 fixed fee for accepted uncovered scope.");
  const draft=await act(pm.page,form,"Draft service invoice");
  form=panel.locator("form").filter({hasText:"Submission basis"});
  await form.locator('input[name="note"]').fill("Submit exact retained fictional scope and terms for independent review.");
  await act(pm.page,form,"Submit invoice for Finance review");

  const finance=await role("finance");
  panel=await open(finance,"Service invoice review");
  form=panel.locator("form").filter({hasText:"Independent source and amount review"});
  await form.locator('input[name="note"]').fill("Independently verified USD 524.65 fixed fee, accepted scope and Net 30 terms.");
  await act(finance.page,form,"Approve exact invoice draft");
  form=panel.locator("form").filter({hasText:"Record fictional issuance"});
  await form.locator('input[name="source"]').fill("FICTIONAL-INVOICE-REGISTER-20261010");
  const issued=await act(finance.page,form,"Record issued invoice");
  panel=await open(finance,"Service payment recording");
  form=panel.locator("form").filter({hasText:"Record fictional payment"});
  await form.locator('input[name="amount"]').fill("100.00");
  await form.locator('input[name="source"]').fill("FICTIONAL-RECEIPT-20261010-100");
  const payment=await act(finance.page,form,"Record payment fact");
  await finance.page.reload();
  const retained=finance.page.locator('section[aria-label="Service invoice and receivable"]');
  await retained.getByText(/outstanding \$424\.65/).waitFor();
  console.log(JSON.stringify({requestId,invoiceId:issued.invoiceId,invoiceNumber:issued.invoiceNumber,
    paymentId:payment.paymentId,invoicedMinor:52465,paidMinor:payment.paidMinor,
    outstandingMinor:payment.outstandingMinor,pm:"drafted and submitted",
    finance:"independently reviewed, issued, recorded fictional partial payment",
    reload:"retained"}));
  await finance.context.close();await pm.context.close();
}finally{await browser.close()}
