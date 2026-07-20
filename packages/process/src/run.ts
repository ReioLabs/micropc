import { type SpawnOptions, spawn, spawnSync } from "node:child_process";
import { MicroPcError } from "@micropc/core/errors.js";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: RunOptions): Promise<RunResult>;
  which(command: string): boolean;
}

export class NodeProcessRunner implements ProcessRunner {
  async run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    if (options.interactive) return runInteractive(command, args, options);
    return runCaptured(command, args, options);
  }

  which(command: string): boolean {
    return spawnSync("/usr/bin/env", ["sh", "-c", 'command -v "$1" >/dev/null 2>&1', "sh", command]).status === 0;
  }
}

export function requireSuccess(result: RunResult, operation: string): RunResult {
  if (result.exitCode !== 0) {
    throw new MicroPcError(
      "EXTERNAL_COMMAND_FAILED",
      `${operation} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.exitCode}`}`,
      { operation, exitCode: result.exitCode },
    );
  }
  return result;
}

async function runInteractive(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: "inherit" });
    let settled = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGTERM");
            reject(new MicroPcError("PROCESS_TIMEOUT", `${command} timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new MicroPcError("PROCESS_START_FAILED", `Failed to start ${command}: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout: "", stderr: "", exitCode: code ?? 1 });
    });
  });
}

async function runCaptured(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] };
    const child = spawn(command, args, spawnOptions);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maximum = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let outputBytes = 0;
    let settled = false;
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            fail(new MicroPcError("PROCESS_TIMEOUT", `${command} timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);

    const fail = (error: MicroPcError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      reject(error);
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximum) {
        fail(new MicroPcError("PROCESS_OUTPUT_LIMIT", `${command} exceeded the ${maximum}-byte output limit`));
        return;
      }
      target.push(chunk);
    };

    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.stdin?.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
        fail(new MicroPcError("PROCESS_INPUT_FAILED", `Failed to write to ${command}: ${error.message}`));
      }
    });
    child.once("error", (error) =>
      fail(new MicroPcError("PROCESS_START_FAILED", `Failed to start ${command}: ${error.message}`)),
    );
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: code ?? 1,
      });
    });
    child.stdin?.end(options.input);
  });
}
