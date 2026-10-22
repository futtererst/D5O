import { spawn } from "node:child_process";
import net from "node:net";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nextCommand = process.platform === "win32" ? "node_modules\\.bin\\next.cmd" : "node_modules/.bin/next";
const configuredBaseUrl = process.env.RYBEX_SMOKE_BASE_URL;
let baseUrl = configuredBaseUrl ?? "http://127.0.0.1:3000";

function commandForPlatform(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args]
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const platformCommand = commandForPlatform(command, args);
    const child = spawn(platformCommand.command, platformCommand.args, {
      stdio: "inherit",
      shell: false,
      ...options
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function waitForServer(url, timeoutMs = 60000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Keep waiting until the server binds.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function isPortFree(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function selectSmokeBaseUrl() {
  if (configuredBaseUrl) {
    const configuredPort = Number(new URL(configuredBaseUrl).port || (configuredBaseUrl.startsWith("https:") ? 443 : 80));
    if (!(await isPortFree(configuredPort))) {
      throw new Error(`Configured smoke port ${configuredPort} is already in use: ${configuredBaseUrl}`);
    }
    return configuredBaseUrl;
  }

  for (const port of [3108, 3109, 3110, 3111, 3112, 3001, 3002]) {
    if (await isPortFree(port)) {
      return `http://127.0.0.1:${port}`;
    }
  }

  throw new Error("No free smoke-test port found.");
}

async function runSmokeWithServer() {
  let devServer;

  try {
    baseUrl = await selectSmokeBaseUrl();
    const smokePort = new URL(baseUrl).port || (baseUrl.startsWith("https:") ? "443" : "80");
    const devCommand = commandForPlatform(nextCommand, ["start", "-p", smokePort]);
    devServer = spawn(devCommand.command, devCommand.args, {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        PORT: smokePort
      }
    });

    await waitForServer(`${baseUrl}/command-center`);
    await run(npmCommand, ["run", "smoke:routes"], {
      env: {
        ...process.env,
        RYBEX_SMOKE_BASE_URL: baseUrl
      }
    });
  } finally {
    await stopProcessTree(devServer);
  }
}

try {
  await run(npmCommand, ["run", "typecheck"]);
  await run(npmCommand, ["run", "lint"]);
  await run(npmCommand, ["run", "build"]);
  await run(npmCommand, ["audit", "--omit=dev"]);
  await run(npmCommand, ["run", "demo:check"]);
  await run(npmCommand, ["run", "workflow:verify-actions"]);
  await run(npmCommand, ["run", "workflow-completion:verify"]);
  await run(npmCommand, ["run", "billing-v2:verify-ui", "--", "--repository-wide"]);
  await run(npmCommand, ["run", "completion-registry:verify"]);
  await run(npmCommand, ["run", "field-issue-completion:verify"]);
  await run(npmCommand, ["run", "closeout-completion:verify"]);
  await run(npmCommand, ["run", "rbac:verify"]);
  await run(npmCommand, ["run", "evidence:verify"]);
  await run(npmCommand, ["run", "notifications:verify"]);
  await run(npmCommand, ["run", "security:verify"]);
  await run(npmCommand, ["run", "pilot:verify"]);
  await run(npmCommand, ["run", "pilot:acceptance-verify"]);
  await run(npmCommand, ["run", "pilot-mode:verify"]);
  await run(npmCommand, ["run", "pilot-progress:verify"]);
  await run(npmCommand, ["run", "pilot-billing-task:verify"]);
  await run(npmCommand, ["run", "pilot-field-closeout:verify"]);
  await run(npmCommand, ["run", "workflow-execution:verify"]);
  await run(npmCommand, ["run", "workflow-outcomes:verify"]);
  await run(npmCommand, ["run", "runtime:verify"]);
  await run(npmCommand, ["run", "d5o-develop-route:qa"]);
  await run(npmCommand, ["run", "workflow-state:verify"]);
  await run(npmCommand, ["run", "simplify:verify"]);
  await runSmokeWithServer();
  console.log("Full RybexOS verification passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
