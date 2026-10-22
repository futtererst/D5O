import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { analyzePrototypeSnapshot } from "./m1/preflight-prototype-snapshot.mjs";

const base = process.env.D5O_REVIEW_BASE ?? "http://127.0.0.1:61431";
assert(["http://127.0.0.1:61430", "http://127.0.0.1:61431"].includes(base), "unexpected local review origin");
const plan = JSON.parse(readFileSync("artifacts/d5o-m1-s1-implementation-20260928T004316Z/domain-implementation-20260928-01/FIXTURE-PLAN-8beb15ad.json", "utf8"));
const password = readFileSync(".rybexos-local/m1-s1/brc-test-password", "utf8").trim();
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const workspace of ["rybex", "rotork"]) {
    const fixture = plan.scenarios.find((entry) => entry.name === workspace);
    assert(fixture, `${workspace} fixture missing`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
    try {
      const page = await context.newPage();
      await page.goto(`${base}/auth/sign-in?next=%2Fwork`);
      await page.getByLabel("Email", { exact: true }).fill(fixture.actors.preparer.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Continue to your work", exact: true }).click();
      await page.waitForURL("**/work");
      assert.equal(new URL(page.url()).pathname, "/work", `Unexpected workspace route: ${new URL(page.url()).pathname}`);
      await page.getByRole("button", { name: "More navigation" }).click();
      await page.getByRole("button", { name: "Dashboard", exact: true }).waitFor();
      await page.getByRole("button", { name: "Close navigation" }).click();
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: /Account/ }).click();
      assert.equal(await page.locator(".d5o-account-trigger").getAttribute("aria-expanded"), "true", "Account menu did not open after hydration");
      const menuText = await page.locator(".d5o-account-popover").innerText();
      assert.match(menuText, /Download prototype Work Record snapshot/, `Account menu content: ${menuText}`);
      const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
      await page.getByRole("menuitem", { name: "Download prototype Work Record snapshot" }).click();
      const download = await downloadPromise;
      if (!download) throw new Error(`No snapshot download for ${workspace}: ${(await page.locator(".d5o-platform-notice").allInnerTexts()).join(" | ") || "no visible notice"}`);
      assert.match(download.suggestedFilename(), new RegExp(`^d5o-${workspace}-prototype-source-${new URL(base).port}-`));
      const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
      assert.equal(exported.payload.format, "d5o-prototype-source-snapshot-v1");
      assert.equal(exported.payload.workspace, workspace);
      assert.equal(exported.payload.browserOrigin, base);
      assert.equal(exported.payload.authority, "presentation-state-only");
      assert(Array.isArray(exported.payload.prototypeConfiguration.workTypes));
      assert.equal(exported.payload.sharedCatalog.workspace, workspace);
      assert(Array.isArray(exported.payload.scheduleReferences.assignments));
      assert(exported.payload.records.length >= 3);
      assert(exported.payload.records.every((entry) => entry.presentation.workspace === workspace
        && entry.source.key === entry.presentation.id && entry.canonicalWorkId === null));
      assert.equal(exported.payloadSha256, createHash("sha256").update(JSON.stringify(exported.payload)).digest("hex"));
      const preflight = analyzePrototypeSnapshot(exported);
      assert.equal(preflight.recordCount, exported.payload.records.length);
      assert.equal(preflight.sourceOnly, true);
      assert(preflight.records.every((record) => record.canonicalWorkId === null));
      const changed = structuredClone(exported);
      changed.payload.records[0].presentation.title = "Tampered title";
      assert.throws(() => analyzePrototypeSnapshot(changed), /snapshot checksum mismatch/);
      const missingSchedule = structuredClone(exported);
      missingSchedule.payload.scheduleReferences = null;
      missingSchedule.payloadSha256 = createHash("sha256").update(JSON.stringify(missingSchedule.payload)).digest("hex");
      assert.throws(() => analyzePrototypeSnapshot(missingSchedule), /shared schedule missing/);
      checks.push(`${workspace} snapshot includes only scoped source identities and validates its checksum`);
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", checks, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally { await browser.close(); }
