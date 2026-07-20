# MicroPC: Technical Architecture

> Status: MVP implementation and operating guide
>
> Scope: one developer, one work Mac, one home Mac host, one SmolVM environment driver, existing CLI coding agents

## Purpose

This document defines the smallest technical system that can prove the product thesis in [product.md](./product.md): a developer can remotely create and reuse isolated project environments, run durable human or agent sessions inside them, and route development ports back to the current client without operating each underlying infrastructure tool directly.

The TypeScript implementation now lives under `packages/`. This document describes the shipped MVP contract and calls out integration work that still requires a host with the real external prerequisites installed.

## Architecture thesis

The system composes existing infrastructure:

```text
Tailscale  → private reachability and NAT traversal
SSH        → authentication, command transport, interactive streams, outer tunnels
SmolVM     → isolated persistent Linux microVMs
filesystem → project, dependency, artifact, and backend-owned conversation state
tmux       → sessions that outlive client connections
agent CLI  → model interaction, agent loop, and native conversation resume
our code   → Host, Computer, Session, Route lifecycle and user experience
```

**MVP decision:** do not introduce a public HTTP control plane, custom relay, custom PTY supervisor, custom VM manager, or product-owned agent loop.

## Goals

1. Make a home Mac useful as remote agent compute through one coherent CLI.
2. Preserve project environments across sleep/wake without promising process-memory hibernation.
3. Isolate projects in separate microVMs with independent filesystems, process trees, package state, and port namespaces.
4. Let existing terminal agents run without modification.
5. Keep client disconnection independent from process lifetime.
6. Route a selected guest port to a predictable client port.
7. Expose stable JSON operations so another agent can use the same interface.
8. Keep package dependencies and state ownership explicit.

## Non-goals

The MVP does not provide:

- multi-user tenancy or hostile local co-tenant isolation;
- a hosted service or browser client;
- a universal agent protocol or conversation database;
- arbitrary cross-provider workload migration;
- automatic scheduling across hosts;
- running-process restoration after a VM has powered off;
- live agent-to-agent messaging;
- secrets management beyond explicit, documented mechanisms;
- automatic Git merging;
- a general plugin marketplace;
- production billing, quotas, RBAC, or audit infrastructure.

## Core domain model

### Host

A registered machine that can execute a computer driver.

```ts
interface Host {
  id: string;
  name: string;
  connector: "local" | "ssh";
  address: string;       // Tailscale DNS name or private address
  user: string;
  platform: "darwin" | "linux";
  capabilities: string[];
}
```

The client stores host connection metadata. The host stores computer and session metadata. Credentials remain with SSH/Tailscale and are not copied into the registry.

### Computer

A persistent isolated project environment backed by one driver machine.

```ts
type ComputerStatus =
  | "provisioning"
  | "running"
  | "sleeping"
  | "error";

interface Computer {
  id: string;
  name: string;
  hostId: string;
  driver: "smolvm";
  driverMachine: string;
  project?: {
    repository: string;
    defaultBranch?: string;
  };
  resources: {
    cpus: number;
    memoryMiB: number;
    diskGiB?: number;
  };
  status: ComputerStatus;
  createdAt: string;
  lastActiveAt: string;
}
```

A computer record is removed only by `destroy`. A sleeping computer retains persistent disk state.

### Session

A named process owned by a computer.

```ts
type SessionKind = "shell" | "command" | "agent" | "service";
type SessionStatus = "starting" | "running" | "exited" | "unknown";

interface Session {
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
}
```

“Agent” is a session kind, not a separate process model. “Subagent” is not a domain object.

### Route

A lease connecting a client port to a port inside one computer.

```ts
interface Route {
  id: string;
  computerId: string;
  guestHost: "127.0.0.1";
  guestPort: number;
  hostLoopbackPort: number;
  clientPort: number;
  createdAt: string;
}
```

The home host exposes the guest service on a loopback-only host port. SSH then forwards that host loopback port to the work Mac. No guest service is published to the LAN or public internet by default.

## Lifecycle semantics

### Computer lifecycle

```text
             create
 absent ─────────────► provisioning ─────► running
                                            │  ▲
                                        sleep  wake
                                            ▼  │
                                         sleeping
                                            │
                                          destroy
                                            ▼
                                          absent
```

Invariants:

- `sleep` releases VM compute and preserves persistent disk state.
- `wake` restarts the environment from its disk; it does not promise restoration of in-memory processes.
- `destroy` is explicit and destructive.
- a route exists only while its outer SSH connection and host-side forwarding lease are alive;
- a session survives client disconnection while the computer remains running;
- session status becomes `unknown` when the host cannot inspect the computer;
- after computer sleep, previously running sessions are `exited` or `unknown`, never silently reported as running.

### Agent conversation lifecycle

The core does not store model messages. An agent adapter may record a backend conversation identifier and provide a resume command.

```ts
interface AgentRecipe {
  id: string;
  displayName: string;
  start(args: AgentStartInput): string[];
  resume?: (conversationId: string) => string[];
  discoverConversationId?: (output: string) => string | undefined;
}
```

If a backend has no stable resume interface, the product preserves its files but does not claim conversation recovery.

## System topology

```text
Work Mac
┌─────────────────────────────────────────┐
│ micropc CLI                                 │
│                                         │
│ host / computer / session / route / agent    │
│ human output + stable --json output     │
└──────────────────┬──────────────────────┘
                   │ SSH over Tailscale
                   ▼
Home Mac
┌─────────────────────────────────────────┐
│ micropc-host command                        │
│                                         │
│ registry   lifecycle   route leases     │
│ diagnostics          SmolVM driver      │
└───────────────┬─────────────────────────┘
                │ local process/API calls
          ┌─────┴──────────────────┐
          ▼                        ▼
┌───────────────────┐    ┌───────────────────┐
│ computer: project-a    │    │ computer: project-b    │
│                   │    │                   │
│ persistent disk   │    │ persistent disk   │
│ tmux sessions     │    │ tmux sessions     │
│ agent CLI         │    │ agent CLI         │
│ app :3000         │    │ app :3000         │
└───────────────────┘    └───────────────────┘
```

The guest microVMs do not need to join the user’s Tailscale network. The home host is the only remote entry point.

## Networking from first principles

A remote workspace needs four layers:

1. **Reachability:** packets can reach the host despite dynamic addresses and NAT.
2. **Identity and encryption:** the host accepts only an authorized client.
3. **Application transport:** commands, terminal bytes, files, and port streams move between endpoints.
4. **Logical routing:** a computer name resolves to a specific environment and session.

In the MVP:

| Layer | Implementation |
| --- | --- |
| Reachability | Tailscale private network |
| Identity and encryption | Tailscale device identity plus SSH authentication |
| Application transport | SSH exec, PTY, file copy, and local forwarding |
| Logical routing | `micropc` client and `micropc-host` registry |

A hosted cloud-agent platform instead exposes a public HTTPS/WebSocket control plane. That control plane authenticates users, maps session IDs to sandboxes, queues commands, persists coordination state, and proxies streams. OpenHands documents this pattern through a remote agent server and workspace API in its [agent-server guide](https://docs.openhands.dev/sdk/guides/agent-server/overview). Ramp’s Inspect uses cloud queues, shared coordination primitives, prepared filesystem snapshots, and Modal Sandboxes, as described in [Modal’s case study](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal).

We do not need that machinery for one user controlling one private host. If browser or team access later becomes validated, an HTTPS/WebSocket connector can be added above the same domain model.

## Isolation choice

### Host processes

A host process is simplest but shares the host filesystem, process namespace, package state, and port namespace. Git worktrees can separate source branches but not the full development environment or trust boundary.

### Containers

Linux containers use namespaces and cgroups to isolate processes while sharing a host kernel. They offer excellent OCI tooling and startup performance. Docker’s [security documentation](https://docs.docker.com/engine/security/) describes namespaces as a primary isolation mechanism.

On macOS, Docker itself runs Linux containers inside a Linux VM; multiple containers generally share that VM’s kernel. Containers may be sufficient for trusted development, but our product deliberately gives each autonomous project environment a stronger computer-like boundary.

### MicroVMs

A microVM gives each computer a guest kernel and hardware virtualization boundary while retaining lightweight startup and image workflows. Firecracker describes this design goal in its [documentation](https://github.com/firecracker-microvm/firecracker). SmolVM implements portable microVMs using platform hypervisors and libkrun and provides the persistent machine lifecycle needed by the MVP.

**MVP decision:** use SmolVM; do not implement a hypervisor.

**Security qualification:** a microVM reduces the direct host attack surface but does not make forwarded capabilities safe. Mounted host directories, SSH-agent sockets, network access, credentials, and exposed ports become part of the computer’s authority. SmolVM itself states that it is not a hardened multi-user control plane. The MVP is single-user personal infrastructure.

## Repository layout

```text
packages/
├── core/               # Pure domain types, transitions, errors, names
├── process/            # Argument-array subprocess execution
├── storage/            # Locked, atomic, versioned JSON state
├── connector/          # Local validation and SSH transport/tunnels
├── driver-smolvm/      # SmolVM command translation and inspection
├── host/               # Host registry and lifecycle composition
├── agents/             # Thin agent recipes and native resume adapters
└── cli/                # Commands, rendering, config, JSON output
```

Dependency direction:

```text
cli ───────────────► core
cli ───────────────► connector
cli ───────────────► host
cli ───────────────► agents

host ──────────────► core
host ──────────────► driver-smolvm
host ──────────────► storage

connector ─────────► core
connector ─────────► process
driver-smolvm ─────► core
driver-smolvm ─────► process
storage ───────────► core
process ───────────► core
agents ────────────► core
```

Rules:

- `core` imports no shell, SSH, VM, UI, or agent libraries.
- `driver-smolvm` knows SmolVM commands but nothing about Tailscale or terminal rendering.
- `connector` knows local/remote process and stream transport but nothing about microVM lifecycle.
- `agents` generates commands and parses backend identifiers; it does not own conversations.
- `cli` is the composition root on the client.
- `host` is the composition root on the registered host.

The MVP is implemented in strict TypeScript on Node.js 22 or newer. Runtime code uses Node built-ins; TypeScript and Node type declarations are development-only dependencies.

## Extension interfaces

Avoid a generic plugin system in the MVP. Keep only interfaces required to isolate external dependencies.

### Connector

```ts
interface Connector {
  request<T>(host: Host, request: HostRequest): Promise<T>;
  interactive(host: Host, request: HostRequest): Promise<void>;
  forward(host: Host, clientPort: number, hostPort: number): Promise<number | undefined>;
}
```

`SshConnector` is the production connector. `LocalConnector` exercises the identical host service on one machine and makes installation checks and autonomous end-to-end validation possible without weakening the remote contract.

### Computer driver

```ts
interface ComputerDriver {
  create(input: CreateMachineInput): Promise<void>;
  inspect(machine: string): Promise<"running" | "sleeping" | "unknown">;
  start(machine: string): Promise<void>;
  stop(machine: string): Promise<void>;
  destroy(machine: string): Promise<void>;
  exec(machine: string, command: string[], options?: ExecOptions): Promise<RunResult>;
  openPort(computer: Computer, guestPort: number): Promise<number>;
  closePort(computer: Computer, hostPort: number, guestPort: number): Promise<void>;
}
```

Only `SmolVmDriver` exists initially. Do not implement or publish a provider marketplace until a second driver proves which parts are genuinely common.

## Command surface

The initial CLI should be shallow and predictable.

```text
micropc host add <name>
micropc host list
micropc host doctor <name>

micropc create <host>/<computer> --repo <url>
micropc list [host]
micropc inspect <host>/<computer>
micropc wake <host>/<computer>
micropc sleep <host>/<computer>
micropc destroy <host>/<computer> --force

micropc shell <host>/<computer>
micropc exec <host>/<computer> -- <command...>

micropc session start <host>/<computer> --name <name> -- <command...>
micropc session list <host>/<computer>
micropc attach <host>/<computer> <session>
micropc session stop <host>/<computer> <session>

micropc agent start <host>/<computer> --backend <id> [--prompt <text>]
micropc agent resume <host>/<computer> <session>

micropc route open <host>/<computer> <guest-port> [--local <port>]
micropc route use <host>/<computer> <guest-port>
micropc route close <route-id>
```

Every non-interactive command supports `--json` with a versioned response envelope. Human output may change; JSON field removal requires a compatibility decision.

## Key flows

### Register a host

1. The user installs the same explicit MicroPC version on the client and host.
2. `micropc host add` records the Tailscale address, SSH user, and connector locally without storing credentials.
3. `micropc host doctor` connects to the host and checks SmolVM plus writable host state.
4. The client also reports whether Tailscale is installed; SSH reachability is proven by the remote diagnostic call itself.
5. Failures remain exact and actionable rather than triggering silent privileged installation.

The MVP may document installation rather than silently installing privileged dependencies.

### Create a computer

1. The client invokes `micropc-host create` over SSH.
2. The host acquires a registry lock and reserves a normalized driver-machine name.
3. `SmolVmDriver` creates and starts a persistent machine from one documented OCI image.
4. The host initializes the project directory inside the guest.
5. Git clones the requested repository inside the computer.
6. The host records the computer only after driver creation succeeds.
7. On partial failure, the record is marked `error` with the driver machine retained for inspection rather than deleted silently.

### Start and attach to a session

1. The host wakes the computer if sleeping.
2. It starts a named `tmux` session inside the guest.
3. The command runs inside that session with an explicit working directory.
4. The client attaches through nested interactive execution: SSH to host, then SmolVM interactive exec, then `tmux attach`.
5. Client disconnect detaches the view; the session remains in the computer.
6. Session listing is rebuilt from `tmux` plus persisted metadata rather than trusting stale metadata alone.

### Start an agent

1. The selected `AgentRecipe` generates the backend command.
2. The command starts as an ordinary durable session.
3. The adapter may discover and persist a backend conversation identifier.
4. Resume generates the backend’s native resume command.
5. Unknown backend behavior remains visible in logs; the core does not transform conversation history.

### Open a route

1. The client asks the host to open guest port 3000 for a specific computer.
2. `SmolVmDriver` creates a loopback-only host forwarding lease and returns its port. The dependency spike must verify whether the current SmolVM release exposes this directly; otherwise the driver may own a small loopback proxy without changing the public route contract.
3. `SshConnector` binds the chosen work-Mac port to that host loopback port.
4. Closing the client tunnel removes the outer route. The host lease is cleaned up explicitly or by timeout.
5. `route use` closes an existing managed binding on the same client port before opening the selected route.

Two guests can both bind port 3000. Only one process can bind the same client port, so simultaneous access uses different client ports; switching reuses one client port sequentially.

**Current SmolVM constraint:** port mappings are changed with `smolvm machine update`, which requires a stopped machine. Opening or closing a new route therefore performs a controlled stop/update/start cycle and reconciles previous sessions as exited. This is visible behavior, not hidden live migration.

## State and storage

### Client state

Stores:

- registered host aliases;
- SSH/Tailscale addressing preferences;
- currently managed route processes;
- CLI preferences.

Use platform-appropriate config and state directories. Do not store private SSH keys or model credentials.

### Host state

Stores:

- versioned computer records;
- session metadata;
- route lease metadata;
- operation logs and last errors.

The MVP uses a versioned JSON file behind a storage interface. Writes take a short-lived lock, recover abandoned stale locks, write a mode-0600 temporary file, and atomically rename it. A database can replace this module if later concurrency demands it; storage choice is not exposed through the domain API.

### Computer state

Stores:

- repository and branches;
- installed dependencies and caches;
- development databases;
- agent backend configuration and conversation files;
- `tmux` session state while running;
- task artifacts.

The host filesystem should not be mounted into the guest by default. Git and explicit copy are the initial exchange mechanisms.

## Credentials and trust

MVP policy:

- Tailscale and SSH credentials remain outside micro-computers.
- Git credentials are configured explicitly inside a trusted computer or provided through opt-in SSH-agent forwarding.
- Agent credentials are configured per computer or baked into a user-controlled image; no central secret vault is provided.
- Host home directories are not mounted automatically.
- Network access is explicit. Coding agents usually require model and package access, so complete network isolation is not a realistic default for the primary workflow.
- Every forwarded capability is documented as an expansion of authority.

Later work may add scoped secret injection and egress policies, but the MVP must not imply security guarantees it does not enforce.

## Failure and recovery behavior

| Failure | Expected behavior |
| --- | --- |
| Work Mac network loss | SSH view ends; running `tmux` sessions remain |
| Work Mac sleep/restart | Managed routes end; user reopens them; sessions remain |
| Home Mac network loss | Micro-computers continue locally; status is unavailable until reconnect |
| Home Mac reboot | Registry persists; VMs are treated as sleeping/stopped until inspected or awakened |
| Computer process exits | Session records reconcile to `exited` with available exit/log information |
| Computer sleep | Guest processes stop; persistent disk remains; routes close |
| SmolVM command partially fails | Operation returns structured error and preserves inspectable state |
| Corrupt/stale metadata | Reconcile against SmolVM and `tmux`; never delete driver state automatically |
| Agent backend changes resume format | Adapter reports unsupported resume; raw files remain available |

Destructive recovery requires explicit user confirmation.

## Implementation phases

### Phase 0: dependency spike

Prove before building abstractions:

1. Create two persistent SmolVM machines on the home Mac.
2. Initialize separate repositories and dependencies.
3. Run an interactive coding agent in each.
4. Keep sessions alive with `tmux` after client disconnect.
5. Run two development servers on guest port 3000.
6. expose and switch work-Mac port 3000 between them through Tailscale and SSH.
7. Stop and restart one VM; verify files, dependencies, and backend resume data remain.
8. Repeat create/start/exec/stop on Linux if available.

Exit criterion: all flows work without modifying SmolVM.

### Phase 1: one-host CLI

Implement host registration, diagnostics, computer lifecycle, JSON output, and a SmolVM adapter. No agent-specific behavior yet.

### Phase 2: sessions and routes

Add `tmux` session lifecycle, reconnectable attach, route leases, and switching.

### Phase 3: agent recipes

Add two or three thin backend recipes with documented native resume limitations.

### Phase 4: dogfood

Use the product for seven working days. Track every direct invocation of SSH, `tmux`, or SmolVM as an abstraction failure. Fix only failures that block the core journey.

### Phase 5: second implementation only after demand

Choose one validated extension—Linux host, cloud VM, alternate connector, or alternate driver—and use it to refine interfaces. Do not build all four.

## Verification plan

### Domain tests

- computer lifecycle transition table;
- destructive-operation guards;
- name and identifier normalization;
- route collision behavior;
- versioned JSON output;
- reconciliation rules.

### Adapter tests

- generated SmolVM and SSH argument arrays;
- structured parsing with representative command outputs;
- timeout, cancellation, and partial-failure handling;
- no shell interpolation for user-provided arguments.

### Integration tests

- create/wake/sleep/destroy against a real SmolVM installation;
- disconnect and reattach to `tmux`;
- route a guest HTTP server to the client;
- two guests using the same guest port;
- host restart reconciliation;
- backend start and supported resume flow.

The repository’s deterministic subprocess-level test uses an executable SmolVM contract double and covers register, doctor, create, exec, session start/list/output, HTTP route forwarding, close, sleep, wake, inspect, and destroy entirely through `micropc`. The real-hardware gate remains the same journey on a Mac with SmolVM, Tailscale, SSH, and an agent CLI installed.

### Manual acceptance demo

A fresh observer should be able to retell this sequence after seeing it once:

1. Create two project micro-computers on the home Mac.
2. Launch one agent in each.
3. Disconnect the work Mac while both continue.
4. Reconnect to either session.
5. Switch `localhost:3000` between the two projects.
6. Sleep and wake a computer without reinstalling its environment.

## Deferred decisions

The following are deliberately unresolved until the MVP produces evidence:

- automatic idle timeout policy;
- process-memory hibernation;
- a public relay or HTTPS/WebSocket control plane;
- web and mobile clients;
- computer snapshots and forks;
- cloud provider contracts;
- general artifact and messaging protocols;
- extension distribution and signing;
- multi-user host security.

## Sources and local references

External:

- [SmolVM](https://github.com/smol-machines/smolvm)
- [Microsandbox](https://github.com/superradcompany/microsandbox)
- [Tailscale architecture](https://tailscale.com/blog/how-tailscale-works)
- [OpenHands architecture](https://docs.openhands.dev/sdk/arch/overview)
- [OpenHands remote agent server](https://docs.openhands.dev/sdk/guides/agent-server/overview)
- [Docker engine security](https://docs.docker.com/engine/security/)
- [Firecracker](https://github.com/firecracker-microvm/firecracker)

Local implementation references:

- `references/orca/docs/reference/headless-linux-server.md`
- `references/orca/docs/agent-status-over-wsl.md`
- `references/orca/docs/terminal-main-owned-state.md`
- `references/orca/README.md`
- `references/pi/AGENTS.md`

Content derived from external sources has been paraphrased for compliance with licensing restrictions.
