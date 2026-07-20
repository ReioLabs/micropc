import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MicroPcError } from "@micropc/core/errors.js";
import { validateSshEndpoint } from "@micropc/core/hosts.js";
import { parseHostRequest } from "@micropc/core/protocol.js";
import { parseClientState } from "@micropc/core/state.js";
import { NodeProcessRunner } from "@micropc/process/run.js";
import { JsonStore } from "@micropc/storage/json-store.js";

test("rejects malformed and unknown host requests", () => {
  assert.throws(
    () => parseHostRequest({ operation: "computer.exec", name: "app", command: "rm -rf /" }),
    isError("INVALID_REQUEST"),
  );
  assert.throws(() => parseHostRequest({ operation: "root.shell" }), isError("UNKNOWN_OPERATION"));
});

test("rejects SSH endpoints that could be interpreted as options", () => {
  assert.throws(() => validateSshEndpoint("-oProxyCommand=bad", "home"), isError("INVALID_SSH_USER"));
  assert.throws(() => validateSshEndpoint("developer", "-oProxyCommand=bad"), isError("INVALID_SSH_ADDRESS"));
  assert.doesNotThrow(() => validateSshEndpoint("developer", "home.tailnet.ts.net"));
});

test("rejects unsupported persisted state versions", () => {
  assert.throws(
    () => parseClientState({ schemaVersion: 2, hosts: [], routes: [] }),
    isError("UNSUPPORTED_STATE_VERSION"),
  );
});

test("rejects corrupted state instead of silently replacing it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "micropc-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "state.json");
  await writeFile(path, "not json");
  const store = new JsonStore(path, {
    initial: () => ({ schemaVersion: 1 as const, hosts: [], routes: [] }),
    parse: parseClientState,
  });
  await assert.rejects(() => store.read(), isError("STATE_READ_FAILED"));
});

test("bounds captured subprocess output", async () => {
  const runner = new NodeProcessRunner();
  await assert.rejects(
    () => runner.run(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024))"], { maxOutputBytes: 10 }),
    isError("PROCESS_OUTPUT_LIMIT"),
  );
});

test("terminates subprocesses that exceed an explicit timeout", async () => {
  const runner = new NodeProcessRunner();
  await assert.rejects(
    () => runner.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 20 }),
    isError("PROCESS_TIMEOUT"),
  );
});

function isError(code: string): (error: unknown) => boolean {
  return (error) => error instanceof MicroPcError && error.code === code;
}
