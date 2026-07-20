import type { ClientState, HostState } from "./domain.js";
import { MicroPcError } from "./errors.js";
import { requireRecord } from "./protocol.js";

const COMPUTER_STATUSES = new Set(["provisioning", "running", "sleeping", "error"]);
const CONNECTORS = new Set(["local", "ssh"]);
const PLATFORMS = new Set(["darwin", "linux"]);
const SESSION_KINDS = new Set(["shell", "command", "agent", "service"]);
const SESSION_STATUSES = new Set(["starting", "running", "exited", "unknown"]);

export function parseClientState(value: unknown): ClientState {
  const state = requireVersionedState(value, "client");
  const hosts = requireArray(state, "hosts");
  const routes = requireArray(state, "routes");
  for (const host of hosts) validateHost(host);
  for (const route of routes) validateRoute(route, true);
  return state as unknown as ClientState;
}

export function parseHostState(value: unknown): HostState {
  const state = requireVersionedState(value, "host");
  const computers = requireArray(state, "computers");
  const sessions = requireArray(state, "sessions");
  const routes = requireArray(state, "routes");
  for (const computer of computers) validateComputer(computer);
  for (const session of sessions) validateSession(session);
  for (const route of routes) validateRoute(route, false);
  return state as unknown as HostState;
}

function validateHost(value: unknown): void {
  const host = requireRecord(value, "host");
  requireStrings(host, ["id", "name", "address", "user", "createdAt"]);
  requireOneOf(host, "connector", CONNECTORS);
  requireOneOf(host, "platform", PLATFORMS);
  requireStringArray(host, "capabilities");
}

function validateComputer(value: unknown): void {
  const computer = requireRecord(value, "computer");
  requireStrings(computer, ["id", "name", "hostId", "driverMachine", "createdAt", "lastActiveAt"]);
  requireLiteral(computer, "driver", "smolvm");
  requireOneOf(computer, "status", COMPUTER_STATUSES);
  optionalString(computer, "lastError");

  const resources = requireRecord(computer.resources, "computer resources");
  requirePositiveInteger(resources, "cpus");
  requirePositiveInteger(resources, "memoryMiB");
  optionalPositiveInteger(resources, "diskGiB");

  if (computer.project !== undefined) {
    const project = requireRecord(computer.project, "computer project");
    requireStrings(project, ["repository"]);
    optionalString(project, "defaultBranch");
  }
}

function validateSession(value: unknown): void {
  const session = requireRecord(value, "session");
  requireStrings(session, ["id", "computerId", "name", "tmuxName", "workingDirectory", "createdAt"]);
  requireOneOf(session, "kind", SESSION_KINDS);
  requireOneOf(session, "status", SESSION_STATUSES);
  requireStringArray(session, "command");
  optionalString(session, "backend");
  optionalString(session, "conversationId");
  optionalInteger(session, "exitCode");
}

function validateRoute(value: unknown, clientState: boolean): void {
  const route = requireRecord(value, "route");
  requireStrings(route, ["id", "computerId", "createdAt"]);
  requireLiteral(route, "guestHost", "127.0.0.1");
  for (const key of ["guestPort", "hostLoopbackPort", "clientPort"] as const) requirePort(route, key);
  if (clientState) optionalPositiveInteger(route, "clientPid");
}

function requireVersionedState(value: unknown, label: string): Record<string, unknown> {
  const state = requireRecord(value, `${label} state`);
  if (state.schemaVersion !== 1) {
    throw new MicroPcError(
      "UNSUPPORTED_STATE_VERSION",
      `Unsupported ${label} state version '${String(state.schemaVersion)}'`,
    );
  }
  return state;
}

function requireArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new MicroPcError("INVALID_STATE", `${key} must be an array`);
  return value;
}

function requireStrings(record: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      throw new MicroPcError("INVALID_STATE", `${key} must be a non-empty string`);
    }
  }
}

function optionalString(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined && typeof record[key] !== "string") {
    throw new MicroPcError("INVALID_STATE", `${key} must be a string`);
  }
}

function requireStringArray(record: Record<string, unknown>, key: string): void {
  if (!Array.isArray(record[key]) || record[key].some((item) => typeof item !== "string")) {
    throw new MicroPcError("INVALID_STATE", `${key} must be a string array`);
  }
}

function requireOneOf(record: Record<string, unknown>, key: string, allowed: ReadonlySet<string>): void {
  if (typeof record[key] !== "string" || !allowed.has(record[key])) {
    throw new MicroPcError("INVALID_STATE", `${key} has unsupported value '${String(record[key])}'`);
  }
}

function requireLiteral(record: Record<string, unknown>, key: string, expected: string): void {
  if (record[key] !== expected) throw new MicroPcError("INVALID_STATE", `${key} must be '${expected}'`);
}

function requirePositiveInteger(record: Record<string, unknown>, key: string): void {
  if (!Number.isInteger(record[key]) || (record[key] as number) < 1) {
    throw new MicroPcError("INVALID_STATE", `${key} must be a positive integer`);
  }
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined) requirePositiveInteger(record, key);
}

function optionalInteger(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined && !Number.isInteger(record[key])) {
    throw new MicroPcError("INVALID_STATE", `${key} must be an integer`);
  }
}

function requirePort(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new MicroPcError("INVALID_STATE", `${key} must be a valid port`);
  }
}
