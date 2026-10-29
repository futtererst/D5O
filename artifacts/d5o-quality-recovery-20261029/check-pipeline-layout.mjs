import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [width, height] of [[1440, 900], [900, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto("http://127.0.0.1:38765/pipeline", { waitUntil: "networkidle" });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    const result = { width, height, status: response?.status(), ...dimensions, overflow: Math.max(dimensions.document, dimensions.body) - dimensions.viewport, errors };
    await page.screenshot({ path: fileURLToPath(new URL(`./browser/pipeline-${width}.png`, import.meta.url)), fullPage: true });
    results.push(result);
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(new URL("./pipeline-layout.json", import.meta.url), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results));
if (results.some((result) => result.status !== 200 || result.overflow > 0 || result.errors.length)) process.exitCode = 1;
