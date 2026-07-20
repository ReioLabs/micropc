export const SCHEMA_VERSION = "1" as const;

export type Platform = "darwin" | "linux";
export type ConnectorKind = "local" | "ssh";
export type ComputerStatus = "provisioning" | "running" | "sleeping" | "error";
export type SessionKind = "shell" | "command" | "agent" | "service";
export type SessionStatus = "starting" | "running" | "exited" | "unknown";

export interface Host {
  id: string;
  name: string;
  connector: ConnectorKind;
  address: string;
  user: string;
  platform: Platform;
  capabilities: string[];
  createdAt: string;
}

export interface Computer {
  id: string;
  name: string;
  hostId: string;
  driver: "smolvm";
  driverMachine: string;
  project?: { repository: string; defaultBranch?: string };
  resources: { cpus: number; memoryMiB: number; diskGiB?: number };
  status: ComputerStatus;
  createdAt: string;
  lastActiveAt: string;
  lastError?: string;
}

export interface Session {
  id: string;
  computerId: string;
  name: string;
  kind: SessionKind;
  backend?: string;
  tmuxName: string;
  command: string[];
  workingDirectory: string;
  status: SessionStatus;
  createdAt: string;
  exitCode?: number;
  conversationId?: string;
}

export interface Route {
  id: string;
  computerId: string;
  guestHost: "127.0.0.1";
  guestPort: number;
  hostLoopbackPort: number;
  clientPort: number;
  createdAt: string;
  clientPid?: number;
}

export interface ClientState {
  schemaVersion: 1;
  hosts: Host[];
  routes: Route[];
}

export interface HostState {
  schemaVersion: 1;
  computers: Computer[];
  sessions: Session[];
  routes: Route[];
}

export interface Diagnostic {
  id: string;
  status: "pass" | "fail" | "warn";
  message: string;
  remediation?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface JsonEnvelope<T = unknown> {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: boolean;
  command: string;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}
