import type { Computer, Diagnostic, ExecResult, Route, Session, SessionKind } from "./domain.js";
import { MicroPcError } from "./errors.js";

export type HostRequest =
  | { operation: "doctor" }
  | {
      operation: "computer.create";
      hostId: string;
      name: string;
      repository?: string;
      image: string;
      cpus: number;
      memoryMiB: number;
      diskGiB?: number;
    }
  | { operation: "computer.list" }
  | { operation: "computer.inspect"; name: string }
  | { operation: "computer.wake"; name: string }
  | { operation: "computer.sleep"; name: string }
  | { operation: "computer.destroy"; name: string }
  | { operation: "computer.exec"; name: string; command: string[]; interactive?: boolean; workdir?: string }
  | {
      operation: "session.start";
      computerName: string;
      name: string;
      kind: SessionKind;
      command: string[];
      workdir: string;
      backend?: string;
    }
  | { operation: "session.list"; computerName: string }
  | { operation: "session.output"; computerName: string; sessionName: string; lines?: number }
  | { operation: "session.attach"; computerName: string; sessionName: string }
  | { operation: "session.stop"; computerName: string; sessionName: string }
  | { operation: "route.open"; computerName: string; guestPort: number; clientPort: number }
  | { operation: "route.close"; routeId: string };

export type HostOperation = HostRequest["operation"];
export type HostRequestFor<Operation extends HostOperation> = Extract<HostRequest, { operation: Operation }>;

export interface HostResponseMap {
  doctor: Diagnostic[];
  "computer.create": Computer;
  "computer.list": Computer[];
  "computer.inspect": {
    computer: Computer;
    actualStatus: "running" | "sleeping" | "unknown";
    sessions: Session[];
    routes: Route[];
  };
  "computer.wake": Computer;
  "computer.sleep": Computer;
  "computer.destroy": Computer;
  "computer.exec": ExecResult;
  "session.start": Session;
  "session.list": Session[];
  "session.output": { session: Session; output: string };
  "session.attach": { exitCode: number };
  "session.stop": Session;
  "route.open": Route;
  "route.close": Route;
}

const OPERATIONS = new Set<HostRequest["operation"]>([
  "doctor",
  "computer.create",
  "computer.list",
  "computer.inspect",
  "computer.wake",
  "computer.sleep",
  "computer.destroy",
  "computer.exec",
  "session.start",
  "session.list",
  "session.output",
  "session.attach",
  "session.stop",
  "route.open",
  "route.close",
]);

const SESSION_KINDS = new Set<SessionKind>(["shell", "command", "agent", "service"]);

export function parseHostRequest(value: unknown): HostRequest {
  const request = requireRecord(value, "request");
  const operation = requireString(request, "operation") as HostRequest["operation"];
  if (!OPERATIONS.has(operation)) throw new MicroPcError("UNKNOWN_OPERATION", `Unknown host operation '${operation}'`);

  switch (operation) {
    case "doctor":
    case "computer.list":
      break;
    case "computer.create":
      requireString(request, "hostId");
      requireString(request, "name");
      optionalString(request, "repository");
      requireString(request, "image");
      requirePositiveInteger(request, "cpus", 256);
      requirePositiveInteger(request, "memoryMiB", 1_048_576);
      optionalPositiveInteger(request, "diskGiB", 1_048_576);
      break;
    case "computer.inspect":
    case "computer.wake":
    case "computer.sleep":
    case "computer.destroy":
      requireString(request, "name");
      break;
    case "computer.exec":
      requireString(request, "name");
      requireStringArray(request, "command");
      optionalBoolean(request, "interactive");
      optionalString(request, "workdir");
      break;
    case "session.start": {
      requireString(request, "computerName");
      requireString(request, "name");
      const kind = requireString(request, "kind") as SessionKind;
      if (!SESSION_KINDS.has(kind)) throw new MicroPcError("INVALID_REQUEST", `Invalid session kind '${kind}'`);
      requireStringArray(request, "command");
      requireString(request, "workdir");
      optionalString(request, "backend");
      break;
    }
    case "session.list":
      requireString(request, "computerName");
      break;
    case "session.output":
      requireString(request, "computerName");
      requireString(request, "sessionName");
      optionalPositiveInteger(request, "lines", 1_000_000);
      break;
    case "session.attach":
    case "session.stop":
      requireString(request, "computerName");
      requireString(request, "sessionName");
      break;
    case "route.open":
      requireString(request, "computerName");
      requirePositiveInteger(request, "guestPort", 65_535);
      requirePositiveInteger(request, "clientPort", 65_535);
      break;
    case "route.close":
      requireString(request, "routeId");
      break;
  }
  return request as unknown as HostRequest;
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MicroPcError("INVALID_REQUEST", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MicroPcError("INVALID_REQUEST", `${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined) requireString(record, key);
}

function requireStringArray(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    throw new MicroPcError("INVALID_REQUEST", `${key} must be a non-empty string array`);
  }
}

function optionalBoolean(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined && typeof record[key] !== "boolean") {
    throw new MicroPcError("INVALID_REQUEST", `${key} must be a boolean`);
  }
}

function requirePositiveInteger(record: Record<string, unknown>, key: string, maximum: number): void {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new MicroPcError("INVALID_REQUEST", `${key} must be an integer between 1 and ${maximum}`);
  }
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string, maximum: number): void {
  if (record[key] !== undefined) requirePositiveInteger(record, key, maximum);
}
