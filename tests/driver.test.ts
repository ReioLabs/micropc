import assert from "node:assert/strict";
import test from "node:test";
import { SmolVmDriver } from "@micropc/driver-smolvm/driver.js";
import type { ProcessRunner, RunResult } from "@micropc/process/run.js";

class RecordingRunner implements ProcessRunner {
  calls: { command: string; args: string[] }[] = [];
  async run(command: string, args: string[]): Promise<RunResult> {
    this.calls.push({ command, args });
    if (args[1] === "status") return { stdout: JSON.stringify({ status: "stopped" }), stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  which(): boolean {
    return true;
  }
}

test("SmolVM driver uses argument arrays for create and start", async () => {
  const runner = new RecordingRunner();
  const driver = new SmolVmDriver(runner, "smolvm-test");
  await driver.create({ name: "micropc-home-app", image: "alpine:3.22", cpus: 2, memoryMiB: 4096, diskGiB: 20 });
  assert.deepEqual(runner.calls[0], {
    command: "smolvm-test",
    args: [
      "machine",
      "create",
      "--name",
      "micropc-home-app",
      "--image",
      "alpine:3.22",
      "--net",
      "--cpus",
      "2",
      "--mem",
      "4096",
      "--storage",
      "20",
    ],
  });
  assert.deepEqual(runner.calls[1]?.args, ["machine", "start", "--name", "micropc-home-app"]);
});

test("SmolVM driver does not guess status from malformed output", async () => {
  const runner = new RecordingRunner();
  runner.run = async () => ({ stdout: "not running", stderr: "", exitCode: 0 });
  const driver = new SmolVmDriver(runner, "smolvm-test");
  assert.equal(await driver.inspect("app"), "unknown");
});
