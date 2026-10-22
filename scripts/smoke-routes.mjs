const baseUrl = process.env.RYBEX_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

const routes = [
  "/command-center",
  "/pilot",
  "/pipeline",
  "/pipeline/new",
  "/projects",
  "/projects/new",
  "/mobilization",
  "/mobilization/new",
  "/field-execution",
  "/field-execution/daily-report/new",
  "/rfis-submittals",
  "/rfis-submittals/rfi/new",
  "/rfis-submittals/submittal/new",
  "/changes",
  "/changes/new",
  "/billing",
  "/billing/pay-application/new",
  "/safety",
  "/safety/record/new",
  "/safety/jha/new",
  "/quality",
  "/quality/inspection/new",
  "/quality/deficiency/new",
  "/closeout",
  "/closeout/package/new",
  "/reports",
  "/reports/lessons-learned/new",
  "/admin"
];

const failures = [];

for (const route of routes) {
  const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
  const ok = response.status >= 200 && response.status < 400;
  const line = `${ok ? "OK" : "FAIL"} ${response.status} ${route}`;
  console.log(line);

  if (!ok) {
    failures.push(line);
  }
}

if (failures.length > 0) {
  console.error(`Route smoke check failed for ${failures.length} route(s).`);
  process.exit(1);
}

console.log(`Route smoke check passed for ${routes.length} route(s) at ${baseUrl}.`);
