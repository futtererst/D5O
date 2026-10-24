import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { rewriteSupabaseConfigForProject } from "../local-supabase-config-utils.mjs";
import { createSanitizedChildEnv, parseSupabaseStatusEnv } from "../cfg-runtime-03-loopback-guard.mjs";
import { assertLoopbackNetwork, inspectSupabaseProjectBindings, loopbackNetworkName, removeLoopbackNetwork } from "../local-supabase-loopback-network.mjs";

const PREFIX = "d5o-p0a-";
const run = (root, command, args, env = createSanitizedChildEnv()) => spawnSync(command, args, {
  cwd: root, env, encoding: "utf8", shell: false, maxBuffer: 1024 * 1024 * 100,
});

export async function createP0aRuntime(root = process.cwd()) {
  root = resolve(root);
  const projectId = `${PREFIX}${randomUUID().slice(0, 12)}`;
  const projectDir = mkdtempSync(join(tmpdir(), projectId + "-"));
  const runtime = { root, projectId, projectDir, network: null, started: false };
  try {
    const ports = {};
    for (const key of ["api", "db", "shadow", "studio", "inbucket", "smtp", "pop3", "analytics", "pooler"])
      ports[key] = await freePort();
    ports.api = await allowedPilotPort();
    runtime.ports = ports;
    cpSync(join(root, "supabase"), join(projectDir, "supabase"), {
      recursive: true,
      filter: (path) => !/[\\/](?:\.temp|\.branches)(?:[\\/]|$)/.test(path) && !/-ShawnT13\.sql$/i.test(path),
    });
    writeFileSync(join(projectDir, "supabase", "config.toml"), rewriteSupabaseConfigForProject(
      readFileSync(join(root, "supabase", "config.toml"), "utf8"), projectId, ports));
    runtime.network = createP0aNetwork(root, projectId);
    const start = run(root, process.execPath, [join(root, "scripts", "run-supabase-loopback.mjs"),
      "start", "--workdir", projectDir, "--network-id", runtime.network, "--yes"]);
    if (start.status !== 0) throw new Error(`isolated_start_failed:api_port=${ports.api}:${start.stderr || start.stdout}`);
    runtime.started = true;
    runtime.bindings = inspectSupabaseProjectBindings(projectId);
    const status = run(root, process.execPath, [join(root, "node_modules", "supabase", "dist", "supabase.js"),
      "status", "-o", "env", "--workdir", projectDir]);
    if (status.status !== 0) throw new Error(`isolated_status_failed:${status.stderr || status.stdout}`);
    runtime.status = parseSupabaseStatusEnv(status.stdout);
    runtime.dbContainer = `supabase_db_${projectId}`;
    return runtime;
  } catch (error) {
    try {
      const cleanup = cleanupP0aRuntime(runtime);
      throw new Error(`${error.message}\ncleanup=${JSON.stringify(cleanup)}`);
    } catch (cleanupError) {
      if (cleanupError.message.includes("\ncleanup=")) throw cleanupError;
      throw new Error(`${error.message}\ncleanup_error=${cleanupError.message}`);
    }
  }
}

export function cleanupP0aRuntime(runtime) {
  const { root, projectId, projectDir } = runtime;
  if (!projectId?.startsWith(PREFIX) || !projectDir) throw new Error("refusing_non_p0a_cleanup");
  const resolved = resolve(projectDir);
  const temp = realpathSync(tmpdir());
  if (!resolved.startsWith(temp + sep) || !resolved.includes(projectId)) throw new Error("cleanup_path_outside_p0a_temp");
  const stop = run(root, process.execPath, [join(root, "node_modules", "supabase", "dist", "supabase.js"),
    "stop", "--workdir", projectDir, "--project-id", projectId, "--no-backup", "--yes"]);
  if (stop.status !== 0) {
    const listed = run(root, "docker", ["ps", "-a", "--format", "{{.Names}}",
      "--filter", `label=com.supabase.cli.project=${projectId}`]);
    const names = listed.stdout.split(/\r?\n/).filter(Boolean);
    if (listed.status !== 0 || names.some((name) => !name.endsWith(projectId)))
      throw new Error("p0a_cleanup_container_identity_mismatch");
    for (const name of names) run(root, "docker", ["rm", "-f", name]);
    const volumes = run(root, "docker", ["volume", "ls", "--format", "{{.Name}}"]).stdout
      .split(/\r?\n/).filter((name) => name.endsWith(projectId));
    for (const name of volumes) run(root, "docker", ["volume", "rm", name]);
  }
  let networkError = null;
  try { if (runtime.network) removeLoopbackNetwork(projectId); } catch (error) { networkError = error.message; }
  rmSync(resolved, { recursive: true, force: true });
  const resources = run(root, "docker", ["ps", "-a", "--format", "{{.Names}}"]);
  const residualContainers = resources.stdout.split(/\r?\n/).filter((name) => name.includes(projectId));
  return { projectId, stopExit: stop.status, networkError, projectDirectoryAbsent: !existsSync(resolved),
    residualContainers, clean: !networkError && !existsSync(resolved) && residualContainers.length === 0 };
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function allowedPilotPort() {
  const published = run(process.cwd(), "docker", ["ps", "--format", "{{.Ports}}"]).stdout;
  for (const port of [57421, 57621, 57721, 58221, 58521, 57021, 57121, 57221]) {
    if (new RegExp(`:${port}->`).test(published)) continue;
    try { await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once("error", reject);
      // Docker publishes the gateway on all interfaces. Probing loopback alone
      // can miss an existing container's port reservation on Windows.
      server.listen(port, "0.0.0.0", () => server.close(resolvePort));
    }); return port; } catch { /* Existing local stacks retain their port. */ }
  }
  throw new Error("no_free_preapproved_pilot_port");
}

function createP0aNetwork(root, projectId) {
  const name = loopbackNetworkName(projectId);
  for (let octet = 240; octet < 250; octet++) {
    const result = run(root, "docker", ["network", "create", "--driver", "bridge",
      "--subnet", `10.253.${octet}.0/24`,
      "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      "--label", "com.rybex.local-only=true", "--label", `com.rybex.supabase-project=${projectId}`, name]);
    if (result.status === 0) { assertLoopbackNetwork(name); return name; }
    if (!/overlap|pool|subnet/i.test(result.stderr)) throw new Error(`p0a_network_create_failed:${result.stderr}`);
  }
  throw new Error("p0a_network_subnet_unavailable");
}
