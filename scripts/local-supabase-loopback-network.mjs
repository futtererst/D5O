import { spawnSync } from "node:child_process";

export const LOOPBACK_BINDING_OPTION = "com.docker.network.bridge.host_binding_ipv4";
export const LOOPBACK_BINDING_ADDRESS = "127.0.0.1";

export function loopbackNetworkName(projectId) {
  const normalized = String(projectId ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("A valid local Supabase project id is required for loopback network authority.");
  return `rybex_loopback_${normalized}`;
}

export function ensureLoopbackNetwork(projectId, options = {}) {
  const networkName = options.networkName ?? loopbackNetworkName(projectId);
  const inspect = runDocker(["network", "inspect", networkName, "--format", "{{json .Options}}"], { allowFailure: true, env: options.env });
  if (inspect.status !== 0) {
    const baseArgs = [
      "network", "create", "--driver", "bridge",
      "--opt", `${LOOPBACK_BINDING_OPTION}=${LOOPBACK_BINDING_ADDRESS}`,
      "--label", "com.rybex.local-only=true",
      "--label", `com.rybex.supabase-project=${projectId}`,
    ];
    let created = runDocker([...baseArgs, networkName], { env: options.env });
    if (created.status !== 0 && /all predefined address pools have been fully subnetted/i.test(created.stderr)) {
      // A busy local Docker daemon can exhaust its default address pool. Use
      // a bounded disposable subnet without changing any existing network.
      for (let octet = 230; octet < 240 && created.status !== 0; octet++) {
        created = runDocker([...baseArgs, "--subnet", `10.253.${octet}.0/24`, networkName], { env: options.env });
        if (created.status !== 0 && !/overlap|pool|subnet/i.test(created.stderr)) break;
      }
    }
    if (created.status !== 0) throw new Error(`Unable to create loopback-authoritative Docker network: ${created.stderr || created.stdout}`);
  }
  assertLoopbackNetwork(networkName, options);
  return networkName;
}

export function assertLoopbackNetwork(networkName, options = {}) {
  const inspected = runDocker(["network", "inspect", networkName, "--format", "{{json .Options}}"], { env: options.env });
  if (inspected.status !== 0) throw new Error(`Loopback-authoritative Docker network is missing: ${networkName}`);
  const parsed = JSON.parse(inspected.stdout.trim() || "{}");
  if (parsed[LOOPBACK_BINDING_OPTION] !== LOOPBACK_BINDING_ADDRESS) {
    throw new Error(`Docker network ${networkName} does not explicitly bind published ports to ${LOOPBACK_BINDING_ADDRESS}.`);
  }
  return parsed;
}

export function guardedSupabaseStartArgs(projectId, baseArgs = []) {
  const networkName = ensureLoopbackNetwork(projectId);
  return [...baseArgs, "--network-id", networkName];
}

export function removeLoopbackNetwork(projectId, options = {}) {
  const networkName = options.networkName ?? loopbackNetworkName(projectId);
  const result = runDocker(["network", "rm", networkName], { allowFailure: true, env: options.env });
  if (result.status !== 0 && !/not found|no such network/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(`Unable to remove disposable loopback network ${networkName}: ${result.stderr || result.stdout}`);
  }
}

export function validatePublishedBindings(bindings, options = {}) {
  const allowedHostIps = new Set(options.allowedHostIps ?? [LOOPBACK_BINDING_ADDRESS]);
  const prohibitedPorts = new Set((options.prohibitedHostPorts ?? ["55329"]).map(String));
  const rows = [];
  for (const [containerPort, mappings] of Object.entries(bindings ?? {})) {
    if (mappings == null) continue;
    if (!Array.isArray(mappings) || mappings.length === 0) throw new Error(`Omitted Docker host binding for ${containerPort}.`);
    for (const mapping of mappings) {
      const hostIp = String(mapping?.HostIp ?? "").trim();
      const hostPort = String(mapping?.HostPort ?? "").trim();
      if (!hostIp) throw new Error(`Empty Docker HostIp for ${containerPort}.`);
      if (!allowedHostIps.has(hostIp)) throw new Error(`Prohibited Docker HostIp ${hostIp} for ${containerPort}.`);
      if (!hostPort) throw new Error(`Empty Docker HostPort for ${containerPort}.`);
      if (prohibitedPorts.has(hostPort)) throw new Error(`Prohibited pooler host port ${hostPort} is published.`);
      rows.push({ containerPort, hostIp, hostPort });
    }
  }
  return rows;
}

export function inspectSupabaseProjectBindings(projectId, options = {}) {
  const listed = runDocker(["ps", "-aq", "--filter", `label=com.supabase.cli.project=${projectId}`], { env: options.env });
  if (listed.status !== 0) throw new Error(`Unable to list local Supabase containers: ${listed.stderr || listed.stdout}`);
  const ids = listed.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0 && options.requireContainers !== false) throw new Error(`No running or stopped containers found for ${projectId}.`);
  const containers = ids.map((id) => {
    const inspected = runDocker(["inspect", id, "--format", "{{json .}}"], { env: options.env });
    if (inspected.status !== 0) throw new Error(`Unable to inspect local container ${id}.`);
    const value = JSON.parse(inspected.stdout);
    return {
      id: value.Id,
      name: String(value.Name ?? "").replace(/^\//, ""),
      state: value.State?.Status ?? "unknown",
      ports: value.NetworkSettings?.Ports ?? {},
      bindings: validatePublishedBindings(value.NetworkSettings?.Ports ?? {}, options),
    };
  });
  return { projectId, containers };
}

function runDocker(args, options = {}) {
  return spawnSync("docker", args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024 * 20,
  });
}
