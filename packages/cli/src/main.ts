#!/usr/bin/env node
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRecipe, listRecipes } from "@micropc/agents/recipes.js";
import { type Connector, LocalConnector, SshConnector } from "@micropc/connector/connector.js";
import type { ClientState, Computer, Host, JsonEnvelope, Route } from "@micropc/core/domain.js";
import { SCHEMA_VERSION } from "@micropc/core/domain.js";
import { asMicroPcError, invariant, MicroPcError } from "@micropc/core/errors.js";
import { validateSshEndpoint } from "@micropc/core/hosts.js";
import { makeId, normalizeName, parseComputerRef } from "@micropc/core/names.js";
import type { HostRequest } from "@micropc/core/protocol.js";
import { parseClientState } from "@micropc/core/state.js";
import { SmolVmDriver } from "@micropc/driver-smolvm/driver.js";
import { HostService } from "@micropc/host/service.js";
import { NodeProcessRunner } from "@micropc/process/run.js";
import { JsonStore } from "@micropc/storage/json-store.js";
import { assertAllowedFlags, flag, numberFlag, type ParsedArgs, parseArgs, positional } from "./args.js";
import { HELP } from "./help.js";
import { runHostService } from "./host-service-entry.js";
import { renderSuccess } from "./output.js";
import { runRouteProxy } from "./route-proxy.js";

declare const __MICROPC_VERSION__: string;
const VERSION = typeof __MICROPC_VERSION__ === "string" ? __MICROPC_VERSION__ : "0.0.0-dev";

const runner = new NodeProcessRunner();
const driver = new SmolVmDriver(runner);
const hostService = new HostService(driver, runner);
const cliEntry = fileURLToPath(import.meta.url);
const localConnector = new LocalConnector((request) => hostService.handle(request), cliEntry);
const sshConnector = new SshConnector(runner, process.env.MICROPC_REMOTE_BINARY ?? "micropc");
const clientStore = new JsonStore<ClientState>(
  join(process.env.MICROPC_HOME ?? join(homedir(), ".config", "micropc"), "state.json"),
  {
    initial: () => ({ schemaVersion: 1, hosts: [], routes: [] }),
    parse: parseClientState,
  },
);

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw[0] === "host-service") return runHostService(hostService, raw.slice(1));
  if (raw[0] === "route-proxy") return runRouteProxy(raw.slice(1));
  const separator = raw.indexOf("--");
  const optionEnd = separator < 0 ? raw.length : separator;
  const globalTokens = raw.slice(0, optionEnd);
  if (raw.length === 0 || globalTokens.includes("--help")) {
    console.log(HELP);
    return;
  }
  if (globalTokens.includes("--version")) {
    console.log(`micropc ${VERSION}`);
    return;
  }
  const json = globalTokens.includes("--json");
  const tokens = raw.filter((token, index) => token !== "--json" || index >= optionEnd);
  const commandName = commandLabel(tokens);
  try {
    const data = await dispatch(tokens);
    renderSuccess(commandName, data, json);
  } catch (error) {
    const value = asMicroPcError(error);
    if (json) {
      const envelope: JsonEnvelope = {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        command: commandName,
        error: {
          code: value.code,
          message: value.message,
          ...(value.details === undefined ? {} : { details: value.details }),
        },
      };
      console.log(JSON.stringify(envelope));
    } else console.error(`Error [${value.code}]: ${value.message}`);
    process.exitCode = value.exitCode;
  }
}

async function dispatch(tokens: string[]): Promise<unknown> {
  const [group, action, ...rest] = tokens;
  if (!group) throw new MicroPcError("COMMAND_REQUIRED", "A command is required");
  if (group === "host") return hostCommand(action, parseArgs(rest));
  if (group === "session") return sessionCommand(action, parseArgs(rest));
  if (group === "agent") return agentCommand(action, parseArgs(rest));
  if (group === "route") return routeCommand(action, parseArgs(rest));
  return computerCommand(group, parseArgs(tokens.slice(1)));
}

async function hostCommand(action: string | undefined, args: ParsedArgs): Promise<unknown> {
  if (action === "add") {
    assertAllowedFlags(args, ["address", "user"]);
    const name = normalizeName(positional(args, 0, "host name"), "host name");
    const address = flag(args, "address", name) as string;
    const connector = address === "local" ? "local" : "ssh";
    const user = flag(args, "user", userInfo().username) as string;
    if (connector === "ssh") validateSshEndpoint(user, address);
    const now = new Date().toISOString();
    const host: Host = {
      id: makeId("host"),
      name,
      connector,
      address,
      user,
      platform: platform() === "linux" ? "linux" : "darwin",
      capabilities: ["smolvm"],
      createdAt: now,
    };
    await clientStore.update((state) => {
      invariant(!state.hosts.some((item) => item.name === name), "HOST_EXISTS", `Host '${name}' is already registered`);
      state.hosts.push(host);
    });
    return { host, next: `Run 'micropc host doctor ${name}' to verify prerequisites.` };
  }
  if (action === "list") {
    assertAllowedFlags(args, []);
    return (await clientStore.read()).hosts;
  }
  if (action === "doctor") {
    assertAllowedFlags(args, []);
    const host = await findHost(positional(args, 0, "host name"));
    const diagnostics = await connectorFor(host).request(host, { operation: "doctor" });
    if (host.connector === "ssh") {
      diagnostics.unshift(
        runner.which("tailscale")
          ? { id: "tailscale-client", status: "pass", message: "Tailscale client is available" }
          : {
              id: "tailscale-client",
              status: "warn",
              message: "Tailscale client was not found; SSH may still work through another private path",
              remediation: "Install and connect Tailscale for the intended private-network workflow",
            },
      );
    }
    return { host: host.name, healthy: diagnostics.every((item) => item.status !== "fail"), diagnostics };
  }
  throw new MicroPcError("UNKNOWN_COMMAND", `Unknown host command '${action ?? ""}'`);
}

async function computerCommand(action: string, args: ParsedArgs): Promise<unknown> {
  if (action === "create") {
    assertAllowedFlags(args, ["repo", "image", "cpus", "memory", "disk"]);
    const resolved = await resolveComputer(positional(args, 0, "computer reference"), false);
    const request = {
      operation: "computer.create",
      hostId: resolved.host.id,
      name: resolved.computerName,
      image: flag(args, "image", "alpine:3.22") as string,
      cpus: numberFlag(args, "cpus", 4, 256) as number,
      memoryMiB: numberFlag(args, "memory", 8192, 1_048_576) as number,
      ...(flag(args, "repo") ? { repository: flag(args, "repo") as string } : {}),
      ...(numberFlag(args, "disk", undefined, 1_048_576) === undefined
        ? {}
        : { diskGiB: numberFlag(args, "disk", undefined, 1_048_576) as number }),
    } satisfies HostRequest;
    return connectorFor(resolved.host).request(resolved.host, request);
  }
  if (action === "list") {
    assertAllowedFlags(args, []);
    const state = await clientStore.read();
    const selected = args.positionals[0] ? [await findHost(args.positionals[0])] : state.hosts;
    const groups = await Promise.all(
      selected.map(async (host) => ({
        host: host.name,
        computers: await connectorFor(host).request(host, { operation: "computer.list" }),
      })),
    );
    return groups;
  }
  const resolved = await resolveComputer(positional(args, 0, "computer reference"));
  const connector = connectorFor(resolved.host);
  if (action === "inspect") {
    assertAllowedFlags(args, []);
    return connector.request(resolved.host, { operation: "computer.inspect", name: resolved.computerName });
  }
  if (action === "wake") {
    assertAllowedFlags(args, []);
    return connector.request(resolved.host, { operation: "computer.wake", name: resolved.computerName });
  }
  if (action === "sleep") {
    assertAllowedFlags(args, []);
    await closeRoutesForComputer(resolved.host, resolved.computerName);
    return connector.request(resolved.host, { operation: "computer.sleep", name: resolved.computerName });
  }
  if (action === "destroy") {
    assertAllowedFlags(args, ["force"]);
    invariant(args.flags.get("force") === true, "CONFIRMATION_REQUIRED", "Destroy is permanent. Re-run with --force.");
    await closeRoutesForComputer(resolved.host, resolved.computerName);
    return connector.request(resolved.host, { operation: "computer.destroy", name: resolved.computerName });
  }
  if (action === "exec") {
    assertAllowedFlags(args, ["workdir"]);
    invariant(args.command.length > 0, "COMMAND_REQUIRED", "Pass a command after --");
    return connector.request(resolved.host, {
      operation: "computer.exec",
      name: resolved.computerName,
      command: args.command,
      workdir: flag(args, "workdir", "/workspace/project") as string,
    });
  }
  if (action === "shell") {
    assertAllowedFlags(args, []);
    await connector.interactive(resolved.host, {
      operation: "computer.exec",
      name: resolved.computerName,
      command: ["/bin/sh"],
      interactive: true,
      workdir: "/workspace/project",
    });
    return { attached: false };
  }
  if (action === "attach") {
    assertAllowedFlags(args, []);
    await connector.interactive(resolved.host, {
      operation: "session.attach",
      computerName: resolved.computerName,
      sessionName: positional(args, 1, "session name"),
    });
    return { attached: true };
  }
  throw new MicroPcError("UNKNOWN_COMMAND", `Unknown command '${action}'`);
}

async function sessionCommand(action: string | undefined, args: ParsedArgs): Promise<unknown> {
  const resolved = await resolveComputer(positional(args, 0, "computer reference"));
  const connector = connectorFor(resolved.host);
  if (action === "start") {
    assertAllowedFlags(args, ["name", "kind", "workdir"]);
    invariant(args.command.length > 0, "COMMAND_REQUIRED", "Pass a session command after --");
    return connector.request(resolved.host, {
      operation: "session.start",
      computerName: resolved.computerName,
      name: flag(args, "name", `session-${Date.now()}`) as string,
      kind: flag(args, "kind", "command") as "command",
      command: args.command,
      workdir: flag(args, "workdir", "/workspace/project") as string,
    });
  }
  if (action === "list") {
    assertAllowedFlags(args, []);
    return connector.request(resolved.host, { operation: "session.list", computerName: resolved.computerName });
  }
  if (action === "output") {
    assertAllowedFlags(args, ["lines"]);
    return connector.request(resolved.host, {
      operation: "session.output",
      computerName: resolved.computerName,
      sessionName: positional(args, 1, "session name"),
      lines: numberFlag(args, "lines", 200, 1_000_000) as number,
    });
  }
  if (action === "stop") {
    assertAllowedFlags(args, []);
    return connector.request(resolved.host, {
      operation: "session.stop",
      computerName: resolved.computerName,
      sessionName: positional(args, 1, "session name"),
    });
  }
  throw new MicroPcError("UNKNOWN_COMMAND", `Unknown session command '${action ?? ""}'`);
}

async function agentCommand(action: string | undefined, args: ParsedArgs): Promise<unknown> {
  if (action === "list") {
    assertAllowedFlags(args, []);
    return listRecipes();
  }
  const resolved = await resolveComputer(positional(args, 0, "computer reference"));
  const connector = connectorFor(resolved.host);
  if (action === "start") {
    assertAllowedFlags(args, ["backend", "name", "prompt"]);
    const backend = flag(args, "backend") ?? "codex";
    const recipe = getRecipe(backend);
    return connector.request(resolved.host, {
      operation: "session.start",
      computerName: resolved.computerName,
      name: flag(args, "name", `${backend}-${Date.now()}`) as string,
      kind: "agent",
      backend,
      command: recipe.start(flag(args, "prompt")),
      workdir: "/workspace/project",
    });
  }
  if (action === "resume") {
    assertAllowedFlags(args, []);
    const sessionName = positional(args, 1, "session name");
    const sessions = await connector.request(resolved.host, {
      operation: "session.list",
      computerName: resolved.computerName,
    });
    const previous = sessions.find((item) => item.name === normalizeName(sessionName));
    invariant(previous?.backend, "AGENT_SESSION_NOT_FOUND", `Agent session '${sessionName}' was not found`);
    const recipe = getRecipe(previous.backend);
    invariant(
      recipe.resume,
      "AGENT_RESUME_UNSUPPORTED",
      `${recipe.displayName} does not expose a supported resume command`,
    );
    return connector.request(resolved.host, {
      operation: "session.start",
      computerName: resolved.computerName,
      name: `${previous.name}-resume-${Date.now()}`,
      kind: "agent",
      backend: previous.backend,
      command: recipe.resume(previous.conversationId),
      workdir: previous.workingDirectory,
    });
  }
  throw new MicroPcError("UNKNOWN_COMMAND", `Unknown agent command '${action ?? ""}'`);
}

async function routeCommand(action: string | undefined, args: ParsedArgs): Promise<unknown> {
  if (action === "list") {
    assertAllowedFlags(args, []);
    return (await clientStore.read()).routes;
  }
  if (action === "close") {
    assertAllowedFlags(args, []);
    return closeClientRoute(positional(args, 0, "route id"));
  }
  if (action !== "open" && action !== "use")
    throw new MicroPcError("UNKNOWN_COMMAND", `Unknown route command '${action ?? ""}'`);
  assertAllowedFlags(args, ["local"]);
  const reference = positional(args, 0, "computer reference");
  const guestPort = parsePort(positional(args, 1, "guest port"));
  const clientPort = numberFlag(args, "local", guestPort, 65_535) as number;
  if (action === "use") {
    const existing = (await clientStore.read()).routes.find((route) => route.clientPort === clientPort);
    if (existing) await closeClientRoute(existing.id);
  } else
    invariant(
      !(await clientStore.read()).routes.some((route) => route.clientPort === clientPort),
      "ROUTE_COLLISION",
      `Client port ${clientPort} is already managed; use 'micropc route use' to switch it`,
    );
  const resolved = await resolveComputer(reference);
  const connector = connectorFor(resolved.host);
  const route = await connector.request(resolved.host, {
    operation: "route.open",
    computerName: resolved.computerName,
    guestPort,
    clientPort,
  });
  try {
    const clientPid = await connector.forward(resolved.host, clientPort, route.hostLoopbackPort);
    const clientRoute = { ...route, ...(clientPid === undefined ? {} : { clientPid }) };
    await clientStore.update((state) => state.routes.push(clientRoute));
    return clientRoute;
  } catch (error) {
    await connector.request(resolved.host, { operation: "route.close", routeId: route.id });
    throw error;
  }
}

async function closeClientRoute(routeId: string): Promise<Route> {
  const state = await clientStore.read();
  const route = state.routes.find((item) => item.id === routeId);
  invariant(route, "ROUTE_NOT_FOUND", `Route '${routeId}' does not exist`);
  if (route.clientPid && route.clientPid > 1) {
    try {
      process.kill(route.clientPid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  const computer = await findComputerById(route.computerId);
  await connectorFor(computer.host).request(computer.host, { operation: "route.close", routeId });
  await clientStore.update((next) => {
    next.routes = next.routes.filter((item) => item.id !== routeId);
  });
  return route;
}

async function resolveComputer(
  reference: string,
  requireExisting = true,
): Promise<{ host: Host; computerName: string }> {
  const parsed = parseComputerRef(reference);
  const host = await findHost(parsed.hostName);
  if (requireExisting) {
    const computers = await connectorFor(host).request(host, { operation: "computer.list" });
    invariant(
      computers.some((item) => item.name === parsed.computerName),
      "COMPUTER_NOT_FOUND",
      `Computer '${reference}' does not exist`,
    );
  }
  return { host, computerName: parsed.computerName };
}

async function findHost(name: string): Promise<Host> {
  const normalized = normalizeName(name, "host name");
  const host = (await clientStore.read()).hosts.find((item) => item.name === normalized);
  invariant(host, "HOST_NOT_FOUND", `Host '${normalized}' is not registered`);
  return host;
}

async function findComputerById(id: string): Promise<{ host: Host; computer: Computer }> {
  for (const host of (await clientStore.read()).hosts) {
    const computer = (await connectorFor(host).request(host, { operation: "computer.list" })).find(
      (item) => item.id === id,
    );
    if (computer) return { host, computer };
  }
  throw new MicroPcError("COMPUTER_NOT_FOUND", `Computer '${id}' does not exist`);
}

async function closeRoutesForComputer(host: Host, computerName: string): Promise<void> {
  const computer = (await connectorFor(host).request(host, { operation: "computer.list" })).find(
    (item) => item.name === computerName,
  );
  if (!computer) return;
  for (const route of (await clientStore.read()).routes.filter((item) => item.computerId === computer.id))
    await closeClientRoute(route.id);
}

function connectorFor(host: Host): Connector {
  return host.connector === "local" ? localConnector : sshConnector;
}
function parsePort(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new MicroPcError("INVALID_PORT", `'${raw}' is not a valid port`);
  return value;
}
function commandLabel(tokens: string[]): string {
  return tokens
    .slice(0, 2)
    .filter((token) => !token.startsWith("--"))
    .join(" ");
}

await main();
