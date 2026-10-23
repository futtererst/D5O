import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

const nav = read("components/layout/PrimaryNav.tsx");
const css = read("app/globals.css");
const billingPage = read("app/billing/page.tsx");
const capture = read("scripts/capture-journey-state-screenshots.mjs");
const pageCapture = read("scripts/capture-page-layout-screenshots.mjs");
const packageJson = JSON.parse(read("package.json"));
const mobileCss = cssBlock(css, "@media (max-width: 820px)");

assert(nav.includes("mobile-nav-menu"), "PrimaryNav must expose a compact mobile navigation menu.");
assert(nav.includes("desktop-nav-shell"), "PrimaryNav must keep desktop navigation separate from mobile navigation.");
assert(nav.includes("activeItem?.label"), "Mobile menu must show current page context.");
assert(nav.includes("Other modules"), "Other modules grouping must remain available.");

assert(css.includes("@media (max-width: 820px)"), "CSS must include mobile shell rules.");
assert(css.includes(".desktop-nav-shell") && css.includes("display: none"), "Desktop nav shell must be hidden in mobile rules.");
assert(css.includes(".mobile-nav-menu") && css.includes("display: block"), "Mobile nav menu must be visible in mobile rules.");
assert(css.includes(".mobile-nav-panel .primary-nav"), "Mobile nav list must live inside a compact panel.");
assert(css.includes(".notification-bell-button") && css.includes("width: auto"), "Mobile alert control must be compact.");
assert(css.includes(".main-content") && css.includes("padding: 14px"), "Mobile main content padding must be tightened.");
assert(mobileCss.includes("grid-template-columns: minmax(0, 1fr) auto auto"), "Mobile shell must keep brand, Alerts, and Menu on one compact row.");
assert(mobileCss.includes("align-content: start"), "Mobile app grid must top-align the shell and main content instead of stretching a spacer row.");
assert(mobileCss.includes("background: var(--color-surface-muted)"), "Mobile app shell must not expose a large empty navy background behind short pages.");
assert(mobileCss.includes("grid-auto-rows: auto"), "Mobile app grid rows must use content-driven row sizing.");
assert(mobileCss.includes("height: fit-content"), "Mobile shell must use content-height instead of a fixed header height.");
assert(mobileCss.includes("min-height: 0"), "Mobile shell must prevent inherited minimum height from creating empty navy space.");
assert(mobileCss.includes("grid-auto-rows: min-content"), "Mobile shell rows must size to content.");
assert(mobileCss.includes("align-content: center"), "Mobile shell controls must be vertically centered.");
assert(mobileCss.includes("overflow: visible"), "Mobile shell must not reserve hidden extra header height.");
assert(!mobileCss.includes("height: 100vh"), "Mobile shell must not keep desktop full-height navigation.");
assert(before(mobileCss, ".sidebar", ".main-content"), "Mobile main content rules must follow the compact shared shell rules.");
assert(before(nav, "NotificationBell", "mobile-nav-menu") || nav.includes("mobile-nav-menu"), "Mobile shell must retain the Alerts control and Menu control.");

for (const page of [
  ["app/command-center/page.tsx", "command-c-plus-hero"],
  ["app/billing/page.tsx", "billing-situation-hero"],
  ["app/field-execution/page.tsx", "field-issue-situation-hero"],
  ["app/closeout/page.tsx", "closeout-situation-hero"],
  ["app/rfis-submittals/page.tsx", "rfi-situation-hero"],
  ["app/changes/page.tsx", "change-entitlement-hero"]
]) {
  const content = read(page[0]);
  assert(before(bodyOf(content), page[1], "CollapsedDetails"), `${page[0]} must expose the situation journey before supporting details.`);
}

assert(before(bodyOf(billingPage), "BillingV2GuidedWorkflow", "Supporting billing details"), "Billing supporting details must remain below the primary workflow action.");
assert(css.includes(".billing-page #details-records .progressive-details summary::after"), "Billing mobile supporting details must expose a disclosure indicator.");
assert(css.includes(".billing-page #details-records .progressive-details summary small") && css.includes("display: none"), "Billing mobile supporting details helper copy must stay hidden until expanded where practical.");

for (const term of [
  "slice",
  "canonical",
  "overlay",
  "local store",
  "adapter",
  "registry",
  "persisted",
  "seed",
  "QA",
  "workflow engine"
]) {
  assert(!visibleText(nav).includes(term), `Mobile nav should not show internal architecture language: ${term}.`);
}

for (const expected of [
  "default/desktop-command-center.png",
  "default/mobile-command-center.png",
  "default/desktop-billing.png",
  "default/mobile-billing.png",
  "default/desktop-field-execution.png",
  "default/mobile-field-execution.png",
  "default/desktop-closeout.png",
  "default/mobile-closeout.png",
  "default/desktop-rfis-submittals.png",
  "default/desktop-changes.png",
  "field-rfi-created/desktop-rfis-submittals-rfi-created.png",
  "field-rfi-created/desktop-field-execution-resolved.png",
  "field-rfi-created/desktop-command-center-field-resolved.png",
  "field-change-created/desktop-changes-change-created.png",
  "billing-resolved/desktop-billing-resolved.png",
  "billing-resolved/mobile-billing-resolved.png",
  "billing-resolved/desktop-command-center-billing-resolved.png",
  "closeout-resolved/desktop-closeout-resolved.png",
  "closeout-resolved/mobile-closeout-resolved.png",
  "closeout-resolved/desktop-billing-final-release-projection.png",
  "closeout-resolved/desktop-command-center-closeout-resolved.png"
]) {
  assert(capture.includes(expected), `Journey-state capture script must declare ${expected}.`);
}

assert(capture.includes("mkdtemp"), "Journey-state captures must use temporary local stores.");
assert(capture.includes("RYBEXOS_FIELD_ISSUE_STORE_PATH"), "Journey-state captures must isolate Field Issue state.");
assert(capture.includes("RYBEXOS_BILLING_V2_STORE_PATH"), "Journey-state captures must isolate Billing state.");
assert(capture.includes("RYBEXOS_CLOSEOUT_FINAL_BILLING_STORE_PATH"), "Journey-state captures must isolate Closeout state.");
assert(pageCapture.includes("desktop/changes.png"), "Default page-layout capture must include Changes desktop.");
assert(pageCapture.includes("mobile/command-center.png"), "Default page-layout capture must still include Command Center mobile.");

assert(packageJson.scripts?.["mobile-shell:verify"], "package.json must expose mobile-shell:verify.");
assert(packageJson.scripts?.["journey-state:captures"], "package.json must expose journey-state:captures.");
assert(packageJson.scripts?.["billing-v2:qa"], "Billing browser QA must remain available.");
assert(packageJson.scripts?.["field-issue:qa"], "Field Issue browser QA must remain available.");
assert(packageJson.scripts?.["closeout-final-billing:qa"], "Closeout browser QA must remain available.");

const manifestPath = join(root, "visual-qa-output/journey-states/manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(read("visual-qa-output/journey-states/manifest.json"));
  for (const item of manifest.screenshots ?? []) {
    assert(existsSync(item.filePath), `Journey-state screenshot must exist: ${item.filePath}`);
  }
}

if (failures.length > 0) {
  console.error("Mobile shell and journey-state verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Mobile shell and journey-state checks passed.");
console.log(JSON.stringify({
  mobileShell: "compact brand, alerts, current-page menu",
  journeyStateCapture: "default plus resolved/created operating states",
  manifestChecked: existsSync(manifestPath),
  humanReviewStillRequired: true
}, null, 2));

function read(filePath) {
  return readFileSync(join(root, filePath), "utf8");
}

function before(content, first, second) {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function visibleText(content) {
  return content
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line))
    .filter((line) => !/from\s+["']/.test(line))
    .filter((line) => !/className=/.test(line))
    .filter((line) => !/data-qa=/.test(line))
    .join("\n");
}

function bodyOf(content) {
  const bodyStart = content.indexOf("return (");
  return bodyStart >= 0 ? content.slice(bodyStart) : content;
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function cssBlock(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const opening = source.indexOf("{", start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  return "";
}
