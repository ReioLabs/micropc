import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("packages/cli/dist/main.js");
const fakeSmolvm = resolve("tests/fixtures/fake-smolvm.mjs");

test("complete local CLI journey", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "micropc-e2e-"));
  await chmod(fakeSmolvm, 0o755);
  const env = {
    ...process.env,
    MICROPC_HOME: join(root, "client"),
    MICROPC_HOST_HOME: join(root, "host"),
    FAKE_SMOLVM_HOME: join(root, "smolvm"),
    MICROPC_SMOLVM_BIN: fakeSmolvm,
  };
  const run = (...args: string[]) => {
    const separator = args.indexOf("--");
    const cliArgs = [...args];
    cliArgs.splice(separator < 0 ? cliArgs.length : separator, 0, "--json");
    const result = spawnSync(process.execPath, [cli, ...cliArgs], { env, encoding: "utf8" });
    assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr}\n${result.stdout}`);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    return body.data;
  };
  const runFail = (...args: string[]) => {
    const separator = args.indexOf("--");
    const cliArgs = [...args];
    cliArgs.splice(separator < 0 ? cliArgs.length : separator, 0, "--json");
    const result = spawnSync(process.execPath, [cli, ...cliArgs], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, false);
    return body.error;
  };
  t.after(async () => {
    for (const name of ["app", "app-two"]) {
      try {
        run("destroy", `home/${name}`, "--force");
      } catch {}
    }
    await rm(root, { recursive: true, force: true });
  });

  run("host", "add", "home", "--address", "local");
  const doctor = run("host", "doctor", "home");
  assert.equal(doctor.healthy, true);
  const created = run("create", "home/app", "--cpus", "2", "--memory", "2048");
  assert.equal(created.status, "running");
  run("create", "home/app-two", "--cpus", "2", "--memory", "2048");
  assert.equal(runFail("destroy", "home/app").code, "CONFIRMATION_REQUIRED");
  const executed = run("exec", "home/app", "--", "printf", "hello");
  assert.equal(executed.stdout, "hello");
  const commandJsonArgument = run("exec", "home/app", "--", "echo", "--json");
  assert.equal(commandJsonArgument.stdout.trim(), "--json");

  const session = run("session", "start", "home/app", "--name", "worker", "--", "sh", "-lc", "echo working");
  assert.equal(session.status, "running");
  const sessions = run("session", "list", "home/app");
  assert.equal(sessions[0].name, "worker");
  const output = run("session", "output", "home/app", "worker");
  assert.match(output.output, /echo working/);

  const localPort = await freePort();
  const route = run("route", "open", "home/app", "3000", "--local", String(localPort));
  assert.equal(route.clientPort, localPort);
  assert.equal(run("session", "list", "home/app")[0].status, "exited");
  const response = await fetch(`http://127.0.0.1:${localPort}`);
  assert.match(await response.text(), /MicroPC .* guest:3000/);
  const switched = run("route", "use", "home/app-two", "3000", "--local", String(localPort));
  assert.notEqual(switched.id, route.id);
  const switchedResponse = await fetch(`http://127.0.0.1:${localPort}`);
  assert.match(await switchedResponse.text(), /app-two.*guest:3000/);
  run("route", "close", switched.id);

  run("sleep", "home/app");
  const sleeping = run("inspect", "home/app");
  assert.equal(sleeping.actualStatus, "sleeping");
  run("wake", "home/app");
  const running = run("inspect", "home/app");
  assert.equal(running.actualStatus, "running");
  run("destroy", "home/app", "--force");
  run("destroy", "home/app-two", "--force");
  const listed = run("list", "home");
  assert.equal(listed[0].computers.length, 0);
  assert.equal(runFail("host", "list", "--unknown", "value").code, "UNKNOWN_OPTION");
});

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("no port"));
      server.close(() => resolvePort(address.port));
    });
  });
}
