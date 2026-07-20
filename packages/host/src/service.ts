import { homedir } from "node:os";
import { join } from "node:path";
import type { Computer, Diagnostic, HostState, Route, Session } from "@micropc/core/domain.js";
import { invariant, MicroPcError } from "@micropc/core/errors.js";
import { makeId, normalizeName } from "@micropc/core/names.js";
import type { HostRequest } from "@micropc/core/protocol.js";
import { parseHostState } from "@micropc/core/state.js";
import { assertTransition } from "@micropc/core/transitions.js";
import type { ComputerDriver } from "@micropc/driver-smolvm/driver.js";
import type { ProcessRunner } from "@micropc/process/run.js";
import { JsonStore } from "@micropc/storage/json-store.js";

export class HostService {
  readonly store: JsonStore<HostState>;
  private readonly driver: ComputerDriver;
  private readonly runner: ProcessRunner;

  constructor(
    driver: ComputerDriver,
    runner: ProcessRunner,
    statePath = join(process.env.MICROPC_HOST_HOME ?? join(homedir(), ".local", "share", "micropc-host"), "state.json"),
  ) {
    this.driver = driver;
    this.runner = runner;
    this.store = new JsonStore(statePath, {
      initial: () => ({ schemaVersion: 1, computers: [], sessions: [], routes: [] }),
      parse: parseHostState,
    });
  }

  async handle(request: HostRequest): Promise<unknown> {
    switch (request.operation) {
      case "doctor":
        return this.doctor();
      case "computer.create":
        return this.createComputer(request);
      case "computer.list":
        return this.listComputers();
      case "computer.inspect":
        return this.inspectComputer(request.name);
      case "computer.wake":
        return this.wakeComputer(request.name);
      case "computer.sleep":
        return this.sleepComputer(request.name);
      case "computer.destroy":
        return this.destroyComputer(request.name);
      case "computer.exec":
        return this.exec(request.name, request.command, request);
      case "session.start":
        return this.startSession(request);
      case "session.list":
        return this.listSessions(request.computerName);
      case "session.output":
        return this.sessionOutput(request.computerName, request.sessionName, request.lines);
      case "session.attach":
        return this.attachSession(request.computerName, request.sessionName);
      case "session.stop":
        return this.stopSession(request.computerName, request.sessionName);
      case "route.open":
        return this.openRoute(request.computerName, request.guestPort, request.clientPort);
      case "route.close":
        return this.closeRoute(request.routeId);
    }
  }

  async doctor(): Promise<Diagnostic[]> {
    const smolvm = process.env.MICROPC_SMOLVM_BIN ?? "smolvm";
    const diagnostics: Diagnostic[] = [];
    diagnostics.push(
      this.runner.which(smolvm)
        ? { id: "smolvm", status: "pass", message: `SmolVM is available as ${smolvm}` }
        : {
            id: "smolvm",
            status: "fail",
            message: `SmolVM is not available as ${smolvm}`,
            remediation: "Install SmolVM from https://github.com/smol-machines/smolvm",
          },
    );
    try {
      const state = await this.store.read();
      await this.store.write(state);
      diagnostics.push({ id: "host-state", status: "pass", message: "Host state directory is writable" });
    } catch (error) {
      diagnostics.push({
        id: "host-state",
        status: "fail",
        message: `Host state is not writable: ${(error as Error).message}`,
        remediation: "Set MICROPC_HOST_HOME to a directory owned by the host user",
      });
    }
    return diagnostics;
  }

  async createComputer(input: Extract<HostRequest, { operation: "computer.create" }>): Promise<Computer> {
    const name = normalizeName(input.name, "computer name");
    const now = new Date().toISOString();
    const driverMachine = `micropc-${normalizeName(input.hostId).slice(0, 18)}-${name}`.slice(0, 63);
    const computer: Computer = {
      id: makeId("computer"),
      name,
      hostId: input.hostId,
      driver: "smolvm",
      driverMachine,
      resources: {
        cpus: input.cpus,
        memoryMiB: input.memoryMiB,
        ...(input.diskGiB === undefined ? {} : { diskGiB: input.diskGiB }),
      },
      status: "provisioning",
      createdAt: now,
      lastActiveAt: now,
      ...(input.repository ? { project: { repository: input.repository } } : {}),
    };
    await this.store.update((state) => {
      invariant(
        !state.computers.some((item) => item.name === name),
        "COMPUTER_EXISTS",
        `Computer '${name}' already exists on this host`,
      );
      state.computers.push(computer);
    });
    try {
      await this.driver.create({
        name: driverMachine,
        image: input.image,
        cpus: input.cpus,
        memoryMiB: input.memoryMiB,
        ...(input.diskGiB === undefined ? {} : { diskGiB: input.diskGiB }),
      });
      if (input.image.startsWith("alpine")) {
        await this.driver.exec(driverMachine, [
          "apk",
          "add",
          "--no-cache",
          "bash",
          "ca-certificates",
          "git",
          "openssh-client",
          "tmux",
        ]);
      }
      await this.driver.exec(driverMachine, ["git", "--version"]);
      await this.driver.exec(driverMachine, ["tmux", "-V"]);
      await this.driver.exec(driverMachine, ["mkdir", "-p", "/workspace/project"]);
      if (input.repository) {
        await this.driver.exec(driverMachine, ["rm", "-rf", "/workspace/project"]);
        await this.driver.exec(driverMachine, ["git", "clone", "--", input.repository, "/workspace/project"]);
      }
      assertTransition(computer.status, "running");
      computer.status = "running";
      computer.lastActiveAt = new Date().toISOString();
      await this.replaceComputer(computer);
      return computer;
    } catch (error) {
      computer.status = "error";
      computer.lastError = error instanceof Error ? error.message : String(error);
      await this.replaceComputer(computer);
      throw error;
    }
  }

  async listComputers(): Promise<Computer[]> {
    const state = await this.store.read();
    return await Promise.all(
      state.computers.map(async (computer) => {
        const actual = await this.driver.inspect(computer.driverMachine);
        if (actual === "running" || actual === "sleeping") computer.status = actual;
        return computer;
      }),
    );
  }

  async inspectComputer(
    name: string,
  ): Promise<{ computer: Computer; actualStatus: string; sessions: Session[]; routes: Route[] }> {
    const state = await this.store.read();
    const computer = this.findComputer(state, name);
    const actualStatus = await this.driver.inspect(computer.driverMachine);
    return {
      computer: {
        ...computer,
        ...(actualStatus === "running" || actualStatus === "sleeping" ? { status: actualStatus } : {}),
      },
      actualStatus,
      sessions: await this.reconcileSessions(state, computer),
      routes: state.routes.filter((route) => route.computerId === computer.id),
    };
  }

  async wakeComputer(name: string): Promise<Computer> {
    const state = await this.store.read();
    const computer = this.findComputer(state, name);
    if ((await this.driver.inspect(computer.driverMachine)) !== "running")
      await this.driver.start(computer.driverMachine);
    computer.status = "running";
    computer.lastActiveAt = new Date().toISOString();
    await this.replaceComputer(computer);
    return computer;
  }

  async sleepComputer(name: string): Promise<Computer> {
    const state = await this.store.read();
    const computer = this.findComputer(state, name);
    for (const route of state.routes.filter((item) => item.computerId === computer.id)) await this.closeRoute(route.id);
    if ((await this.driver.inspect(computer.driverMachine)) === "running")
      await this.driver.stop(computer.driverMachine);
    computer.status = "sleeping";
    await this.store.update((next) => {
      const index = next.computers.findIndex((item) => item.id === computer.id);
      if (index >= 0) next.computers[index] = computer;
      for (const session of next.sessions.filter(
        (item) => item.computerId === computer.id && item.status === "running",
      ))
        session.status = "exited";
    });
    return computer;
  }

  async destroyComputer(name: string): Promise<Computer> {
    const state = await this.store.read();
    const computer = this.findComputer(state, name);
    for (const route of state.routes.filter((item) => item.computerId === computer.id)) await this.closeRoute(route.id);
    await this.driver.destroy(computer.driverMachine);
    await this.store.update((next) => {
      next.computers = next.computers.filter((item) => item.id !== computer.id);
      next.sessions = next.sessions.filter((item) => item.computerId !== computer.id);
      next.routes = next.routes.filter((item) => item.computerId !== computer.id);
    });
    return computer;
  }

  async exec(
    name: string,
    command: string[],
    options: { interactive?: boolean; workdir?: string },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const computer = await this.ensureRunning(name);
    return this.driver.exec(computer.driverMachine, command, {
      ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
      ...(options.workdir ? { workdir: options.workdir } : {}),
    });
  }

  async startSession(input: Extract<HostRequest, { operation: "session.start" }>): Promise<Session> {
    invariant(input.command.length > 0, "COMMAND_REQUIRED", "A session command is required");
    const computer = await this.ensureRunning(input.computerName);
    const name = normalizeName(input.name, "session name");
    const state = await this.store.read();
    invariant(
      !state.sessions.some(
        (item) => item.computerId === computer.id && item.name === name && item.status === "running",
      ),
      "SESSION_EXISTS",
      `Running session '${name}' already exists`,
    );
    const tmuxName = `micropc-${computer.id.slice(-8)}-${name}`;
    const session: Session = {
      id: makeId("session"),
      computerId: computer.id,
      name,
      kind: input.kind,
      ...(input.backend ? { backend: input.backend } : {}),
      tmuxName,
      command: input.command,
      workingDirectory: input.workdir,
      status: "starting",
      createdAt: new Date().toISOString(),
    };
    await this.store.update((next) => next.sessions.push(session));
    const result = await this.driver.exec(
      computer.driverMachine,
      ["tmux", "new-session", "-d", "-s", tmuxName, "-c", input.workdir, "--", ...input.command],
      { allowFailure: true },
    );
    session.status = result.exitCode === 0 ? "running" : "exited";
    if (result.exitCode !== 0) session.exitCode = result.exitCode;
    await this.replaceSession(session);
    if (result.exitCode !== 0)
      throw new MicroPcError("SESSION_START_FAILED", result.stderr.trim() || `tmux exited ${result.exitCode}`);
    return session;
  }

  async listSessions(computerName: string): Promise<Session[]> {
    const state = await this.store.read();
    return this.reconcileSessions(state, this.findComputer(state, computerName));
  }

  async sessionOutput(
    computerName: string,
    sessionName: string,
    lines = 200,
  ): Promise<{ session: Session; output: string }> {
    const { computer, session } = await this.findSession(computerName, sessionName);
    const result = await this.driver.exec(
      computer.driverMachine,
      ["tmux", "capture-pane", "-p", "-t", session.tmuxName, "-S", `-${Math.max(1, lines)}`],
      { allowFailure: true },
    );
    if (result.exitCode !== 0)
      throw new MicroPcError("SESSION_NOT_RUNNING", `Session '${session.name}' is not running`);
    return { session, output: result.stdout };
  }

  async attachSession(computerName: string, sessionName: string): Promise<{ exitCode: number }> {
    const { computer, session } = await this.findSession(computerName, sessionName);
    const result = await this.driver.exec(computer.driverMachine, ["tmux", "attach-session", "-t", session.tmuxName], {
      interactive: true,
      allowFailure: true,
    });
    return { exitCode: result.exitCode };
  }

  async stopSession(computerName: string, sessionName: string): Promise<Session> {
    const { computer, session } = await this.findSession(computerName, sessionName);
    await this.driver.exec(computer.driverMachine, ["tmux", "kill-session", "-t", session.tmuxName], {
      allowFailure: true,
    });
    session.status = "exited";
    await this.replaceSession(session);
    return session;
  }

  async openRoute(computerName: string, guestPort: number, clientPort: number): Promise<Route> {
    const computer = await this.ensureRunning(computerName);
    const hostLoopbackPort = await this.driver.openPort(computer, guestPort);
    const route: Route = {
      id: makeId("route"),
      computerId: computer.id,
      guestHost: "127.0.0.1",
      guestPort,
      hostLoopbackPort,
      clientPort,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.store.update((state) => {
        markSessionsExited(state, computer.id);
        state.routes.push(route);
      });
      return route;
    } catch (error) {
      await this.driver.closePort(computer, hostLoopbackPort, guestPort);
      throw error;
    }
  }

  async closeRoute(routeId: string): Promise<Route> {
    const state = await this.store.read();
    const route = state.routes.find((item) => item.id === routeId);
    invariant(route, "ROUTE_NOT_FOUND", `Route '${routeId}' does not exist`);
    const computer = state.computers.find((item) => item.id === route.computerId);
    invariant(computer, "COMPUTER_NOT_FOUND", `Computer for route '${routeId}' does not exist`);
    await this.driver.closePort(computer, route.hostLoopbackPort, route.guestPort);
    await this.store.update((next) => {
      markSessionsExited(next, computer.id);
      next.routes = next.routes.filter((item) => item.id !== route.id);
    });
    return route;
  }

  private findComputer(state: HostState, name: string): Computer {
    const normalized = normalizeName(name, "computer name");
    const computer = state.computers.find((item) => item.name === normalized);
    invariant(computer, "COMPUTER_NOT_FOUND", `Computer '${normalized}' does not exist`);
    return computer;
  }

  private async ensureRunning(name: string): Promise<Computer> {
    const state = await this.store.read();
    const computer = this.findComputer(state, name);
    if ((await this.driver.inspect(computer.driverMachine)) !== "running")
      await this.driver.start(computer.driverMachine);
    if (computer.status !== "running") {
      computer.status = "running";
      computer.lastActiveAt = new Date().toISOString();
      await this.replaceComputer(computer);
    }
    return computer;
  }

  private async reconcileSessions(state: HostState, computer: Computer): Promise<Session[]> {
    const actualComputerStatus = await this.driver.inspect(computer.driverMachine);
    const sessions = state.sessions.filter((item) => item.computerId === computer.id);
    for (const session of sessions) {
      if (actualComputerStatus !== "running") session.status = session.status === "starting" ? "unknown" : "exited";
      else {
        const result = await this.driver.exec(computer.driverMachine, ["tmux", "has-session", "-t", session.tmuxName], {
          allowFailure: true,
        });
        session.status = result.exitCode === 0 ? "running" : "exited";
      }
    }
    await this.store.update((next) => {
      for (const session of sessions) {
        const index = next.sessions.findIndex((item) => item.id === session.id);
        if (index >= 0) next.sessions[index] = session;
      }
    });
    return sessions;
  }

  private async findSession(
    computerName: string,
    sessionName: string,
  ): Promise<{ computer: Computer; session: Session }> {
    const state = await this.store.read();
    const computer = this.findComputer(state, computerName);
    const normalized = normalizeName(sessionName, "session name");
    const session = state.sessions.find((item) => item.computerId === computer.id && item.name === normalized);
    invariant(session, "SESSION_NOT_FOUND", `Session '${normalized}' does not exist`);
    return { computer, session };
  }

  private async replaceComputer(computer: Computer): Promise<void> {
    await this.store.update((state) => {
      const index = state.computers.findIndex((item) => item.id === computer.id);
      invariant(index >= 0, "COMPUTER_NOT_FOUND", `Computer '${computer.name}' does not exist`);
      state.computers[index] = computer;
    });
  }

  private async replaceSession(session: Session): Promise<void> {
    await this.store.update((state) => {
      const index = state.sessions.findIndex((item) => item.id === session.id);
      invariant(index >= 0, "SESSION_NOT_FOUND", `Session '${session.name}' does not exist`);
      state.sessions[index] = session;
    });
  }
}

function markSessionsExited(state: HostState, computerId: string): void {
  for (const session of state.sessions) {
    if (session.computerId === computerId && (session.status === "running" || session.status === "starting")) {
      session.status = "exited";
    }
  }
}
