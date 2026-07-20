import { createServer } from "node:net";
import type { Computer } from "@micropc/core/domain.js";
import { MicroPcError } from "@micropc/core/errors.js";
import type { ProcessRunner, RunResult } from "@micropc/process/run.js";
import { requireSuccess } from "@micropc/process/run.js";

export interface CreateMachineInput {
  name: string;
  image: string;
  cpus: number;
  memoryMiB: number;
  diskGiB?: number;
}

export interface ComputerDriver {
  create(input: CreateMachineInput): Promise<void>;
  inspect(name: string): Promise<"running" | "sleeping" | "unknown">;
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  destroy(name: string): Promise<void>;
  exec(
    name: string,
    command: string[],
    options?: { interactive?: boolean; workdir?: string; allowFailure?: boolean },
  ): Promise<RunResult>;
  openPort(computer: Computer, guestPort: number, preferredHostPort?: number): Promise<number>;
  closePort(computer: Computer, hostPort: number, guestPort: number): Promise<void>;
}

export class SmolVmDriver implements ComputerDriver {
  private readonly binary: string;
  private readonly runner: ProcessRunner;

  constructor(runner: ProcessRunner, binary = process.env.MICROPC_SMOLVM_BIN ?? "smolvm") {
    this.runner = runner;
    this.binary = binary;
  }

  async create(input: CreateMachineInput): Promise<void> {
    const args = [
      "machine",
      "create",
      "--name",
      input.name,
      "--image",
      input.image,
      "--net",
      "--cpus",
      String(input.cpus),
      "--mem",
      String(input.memoryMiB),
    ];
    if (input.diskGiB !== undefined) args.push("--storage", String(input.diskGiB));
    requireSuccess(await this.runner.run(this.binary, args), `Create SmolVM machine ${input.name}`);
    await this.start(input.name);
  }

  async inspect(name: string): Promise<"running" | "sleeping" | "unknown"> {
    const result = await this.runner.run(this.binary, ["machine", "status", "--name", name, "--json"]);
    if (result.exitCode !== 0) return "unknown";
    try {
      const data = JSON.parse(result.stdout) as { state?: unknown; status?: unknown };
      const state = String(data.state ?? data.status ?? "").toLowerCase();
      if (state === "running") return "running";
      if (state === "stopped" || state === "created") return "sleeping";
    } catch {
      return "unknown";
    }
    return "unknown";
  }

  async start(name: string): Promise<void> {
    requireSuccess(
      await this.runner.run(this.binary, ["machine", "start", "--name", name]),
      `Start SmolVM machine ${name}`,
    );
  }

  async stop(name: string): Promise<void> {
    requireSuccess(
      await this.runner.run(this.binary, ["machine", "stop", "--name", name]),
      `Stop SmolVM machine ${name}`,
    );
  }

  async destroy(name: string): Promise<void> {
    requireSuccess(
      await this.runner.run(this.binary, ["machine", "delete", "--name", name, "--force"]),
      `Delete SmolVM machine ${name}`,
    );
  }

  async exec(
    name: string,
    command: string[],
    options: { interactive?: boolean; workdir?: string; allowFailure?: boolean } = {},
  ): Promise<RunResult> {
    if (command.length === 0) throw new MicroPcError("COMMAND_REQUIRED", "A command is required");
    const args = ["machine", "exec", "--name", name];
    if (options.interactive) args.push("-it");
    if (options.workdir) args.push("--workdir", options.workdir);
    args.push("--", ...command);
    const result = await this.runner.run(
      this.binary,
      args,
      options.interactive === undefined ? {} : { interactive: options.interactive },
    );
    return options.interactive || options.allowFailure ? result : requireSuccess(result, `Execute command in ${name}`);
  }

  async openPort(computer: Computer, guestPort: number, preferredHostPort?: number): Promise<number> {
    const hostPort = preferredHostPort ?? (await findFreePort());
    const wasRunning = (await this.inspect(computer.driverMachine)) === "running";
    if (wasRunning) await this.stop(computer.driverMachine);
    try {
      requireSuccess(
        await this.runner.run(this.binary, [
          "machine",
          "update",
          "--name",
          computer.driverMachine,
          "--port",
          `${hostPort}:${guestPort}`,
        ]),
        `Publish port ${guestPort} from ${computer.name}`,
      );
    } finally {
      if (wasRunning) await this.start(computer.driverMachine);
    }
    return hostPort;
  }

  async closePort(computer: Computer, hostPort: number, guestPort: number): Promise<void> {
    const wasRunning = (await this.inspect(computer.driverMachine)) === "running";
    if (wasRunning) await this.stop(computer.driverMachine);
    try {
      requireSuccess(
        await this.runner.run(this.binary, [
          "machine",
          "update",
          "--name",
          computer.driverMachine,
          "--remove-port",
          `${hostPort}:${guestPort}`,
        ]),
        `Remove port ${guestPort} from ${computer.name}`,
      );
    } finally {
      if (wasRunning) await this.start(computer.driverMachine);
    }
  }
}

export async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a loopback port"));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
