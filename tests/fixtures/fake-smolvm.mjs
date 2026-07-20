#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const root = process.env.FAKE_SMOLVM_HOME;
if (!root) throw new Error("FAKE_SMOLVM_HOME is required");
mkdirSync(root, { recursive: true });
const statePath = join(root, "state.json");
const read = () => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { machines: {} });
const write = (state) => writeFileSync(statePath, JSON.stringify(state));
const args = process.argv.slice(2);

if (args[0] === "__serve") {
  const name = args[1];
  const machine = read().machines[name];
  for (const mapping of machine?.ports ?? []) {
    const [host, guest] = mapping.split(":").map(Number);
    createServer((socket) =>
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nMicroPC ${name} guest:${guest}\n`,
      ),
    ).listen(host, "127.0.0.1");
  }
  setInterval(() => {}, 60_000);
} else {
  const state = read();
  const value = (name) => args[args.indexOf(name) + 1];
  const name = value("--name");
  const command = args[1];
  const machine = state.machines[name];
  const stop = () => {
    if (machine?.pid) {
      try {
        process.kill(machine.pid, "SIGTERM");
      } catch {}
      delete machine.pid;
    }
  };
  if (args[0] !== "machine") process.exit(2);
  if (command === "create") {
    state.machines[name] = { status: "created", ports: [], sessions: {} };
  } else if (command === "start") {
    if (!machine) process.exit(1);
    stop();
    machine.status = "running";
    const child = spawn(process.execPath, [process.argv[1], "__serve", name], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    machine.pid = child.pid;
  } else if (command === "stop") {
    if (!machine) process.exit(1);
    stop();
    machine.status = "stopped";
    machine.sessions = {};
  } else if (command === "delete") {
    if (!machine) process.exit(1);
    stop();
    delete state.machines[name];
  } else if (command === "status") {
    if (!machine) process.exit(1);
    console.log(JSON.stringify({ status: machine.status }));
  } else if (command === "update") {
    if (!machine || machine.status === "running") process.exit(1);
    const added = value("--port");
    const removed = value("--remove-port");
    if (added && !machine.ports.includes(added)) machine.ports.push(added);
    if (removed) machine.ports = machine.ports.filter((item) => item !== removed);
  } else if (command === "exec") {
    if (machine?.status !== "running") process.exit(1);
    const separator = args.indexOf("--");
    const guest = args.slice(separator + 1);
    if (guest[0] === "tmux") {
      const operation = guest[1];
      const targetAt = guest.indexOf("-t");
      const target = targetAt >= 0 ? guest[targetAt + 1] : undefined;
      if (operation === "new-session") {
        const sessionName = guest[guest.indexOf("-s") + 1];
        machine.sessions[sessionName] = { output: `started ${guest.slice(guest.indexOf("--") + 1).join(" ")}\n` };
      } else if (operation === "has-session") {
        if (!machine.sessions[target]) process.exitCode = 1;
      } else if (operation === "capture-pane") {
        if (!machine.sessions[target]) process.exitCode = 1;
        else process.stdout.write(machine.sessions[target].output);
      } else if (operation === "kill-session") {
        delete machine.sessions[target];
      }
    } else if (guest[0] === "printf") {
      process.stdout.write(guest.slice(1).join(" "));
    } else if (guest[0] === "echo") {
      console.log(guest.slice(1).join(" "));
    }
  } else process.exitCode = 2;
  write(state);
}
