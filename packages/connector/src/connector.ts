import { spawn } from "node:child_process";
import { Socket } from "node:net";
import type { Host } from "@micropc/core/domain.js";
import { MicroPcError } from "@micropc/core/errors.js";
import type { HostOperation, HostRequest, HostRequestFor, HostResponseMap } from "@micropc/core/protocol.js";
import type { ProcessRunner } from "@micropc/process/run.js";
import { requireSuccess } from "@micropc/process/run.js";

export interface Connector {
  request<Operation extends HostOperation>(
    host: Host,
    request: HostRequestFor<Operation>,
  ): Promise<HostResponseMap[Operation]>;
  interactive(host: Host, request: HostRequest): Promise<void>;
  forward(host: Host, clientPort: number, hostPort: number): Promise<number | undefined>;
}

export type LocalHandler = (request: HostRequest) => Promise<unknown>;

export class LocalConnector implements Connector {
  private readonly handler: LocalHandler;
  private readonly cliEntry: string;

  constructor(handler: LocalHandler, cliEntry: string) {
    this.handler = handler;
    this.cliEntry = cliEntry;
  }

  async request<Operation extends HostOperation>(
    _host: Host,
    request: HostRequestFor<Operation>,
  ): Promise<HostResponseMap[Operation]> {
    return (await this.handler(request)) as HostResponseMap[Operation];
  }

  async interactive(_host: Host, request: HostRequest): Promise<void> {
    await this.handler(request);
  }

  async forward(_host: Host, clientPort: number, hostPort: number): Promise<number | undefined> {
    if (clientPort === hostPort) return undefined;
    const child = spawn(
      process.execPath,
      [this.cliEntry, "route-proxy", "--listen", String(clientPort), "--target", String(hostPort)],
      {
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.unref();
    if (!child.pid) throw new MicroPcError("ROUTE_START_FAILED", "Could not start the local route proxy");
    await waitForPort(clientPort, child.pid);
    return child.pid;
  }
}

export class SshConnector implements Connector {
  private readonly runner: ProcessRunner;
  private readonly remoteBinary: string;

  constructor(runner: ProcessRunner, remoteBinary = "micropc") {
    this.runner = runner;
    this.remoteBinary = remoteBinary;
  }

  async request<Operation extends HostOperation>(
    host: Host,
    request: HostRequestFor<Operation>,
  ): Promise<HostResponseMap[Operation]> {
    const result = requireSuccess(
      await this.runner.run("ssh", [sshTarget(host), this.remoteBinary, "host-service"], {
        input: JSON.stringify(request),
      }),
      `Remote ${request.operation} on ${host.name}`,
    );
    const response = parseRemoteResponse<HostResponseMap[Operation]>(result.stdout);
    if (!response.ok)
      throw new MicroPcError(
        response.error?.code ?? "REMOTE_ERROR",
        response.error?.message ?? "Remote operation failed",
        response.error?.details,
      );
    return response.data as HostResponseMap[Operation];
  }

  async interactive(host: Host, request: HostRequest): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(request)).toString("base64url");
    const result = await this.runner.run(
      "ssh",
      ["-t", sshTarget(host), this.remoteBinary, "host-service", "--request", encoded],
      { interactive: true },
    );
    if (result.exitCode !== 0)
      throw new MicroPcError("REMOTE_INTERACTIVE_FAILED", `Remote interactive operation exited ${result.exitCode}`);
  }

  async forward(host: Host, clientPort: number, hostPort: number): Promise<number> {
    const child = spawn(
      "ssh",
      ["-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${clientPort}:127.0.0.1:${hostPort}`, sshTarget(host)],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    if (!child.pid) throw new MicroPcError("ROUTE_START_FAILED", "Could not start the SSH route");
    await waitForPort(clientPort, child.pid);
    return child.pid;
  }
}

function parseRemoteResponse<T>(text: string): {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MicroPcError("INVALID_REMOTE_RESPONSE", "The remote MicroPC host returned invalid JSON");
  }
  if (typeof value !== "object" || value === null || typeof (value as { ok?: unknown }).ok !== "boolean") {
    throw new MicroPcError("INVALID_REMOTE_RESPONSE", "The remote MicroPC host returned an invalid response envelope");
  }
  return value as { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };
}

function sshTarget(host: Host): string {
  return `${host.user}@${host.address}`;
}

async function waitForPort(port: number, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        socket.setTimeout(100);
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("timeout", () => {
          socket.destroy();
          reject(new Error("timeout"));
        });
        socket.once("error", reject);
        socket.connect(port, "127.0.0.1");
      });
      return;
    } catch {
      try {
        process.kill(pid, 0);
      } catch {
        throw new MicroPcError("ROUTE_START_FAILED", `Route process ${pid} exited before binding port ${port}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  throw new MicroPcError("ROUTE_START_TIMEOUT", `Timed out waiting for local port ${port}`);
}
