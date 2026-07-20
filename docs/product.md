# MicroPC: Open Agent Workspaces

> Status: MVP implemented
>
> Project name: **MicroPC**. CLI name: **`micropc`**. The project primitive is a **micro-computer**, shortened to **computer** in commands and prose.

## One-line idea

Turn machines developers already own into hosts for isolated, persistent agent workspaces that can be controlled from anywhere by humans or other agents.

## The problem

Coding agents increasingly run long, resource-intensive tasks. A developer may have a work laptop in an office or café while a more powerful Mac, Linux workstation, home server, or cloud VM sits unused elsewhere.

The existing choices are unsatisfying for many individual developers:

- Run every agent locally and accept CPU, memory, battery, and workspace contention.
- Assemble SSH, VPN networking, terminal multiplexers, port forwarding, VM tooling, and scripts manually.
- Move the workflow into a hosted cloud-agent platform and accept its agent, infrastructure, state model, pricing, and extension boundaries.
- Self-host a full agent platform designed for broader production or multi-user requirements.

None of these options directly answers the personal workflow:

> I want each project to have an isolated computer that remembers its environment, runs on hardware I control, and remains reachable from the laptop in front of me.

### The motivating case

The initial user owns two Macs:

- a work Mac that travels with them;
- a more powerful home Mac that is often idle;
- coding-agent sessions that consume significant local resources;
- little interest in learning and operating SSH, Tailscale, `tmux`, VM networking, and port forwarding as separate systems.

They want to start or resume a project environment on the home Mac, run Codex, Droid, Pi, Claude Code, or another CLI agent inside it, disconnect safely, return later, and inspect a development server from the work Mac’s browser.

## Why this matters

Remote agent execution is becoming a normal development workflow. Amp’s hosted [Orbs](https://ampcode.com/news/agents-in-orbs) make fresh remote machines available to agent threads. [Factory Droid Computers](https://factory.ai/news/droid-computers) emphasize persistent environments and allow users to bring their own machines. [Ramp Inspect](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal) demonstrates why prepared, isolated environments and background execution matter at organizational scale.

These products validate demand, but they bundle several concerns:

- an agent implementation;
- environment provisioning;
- isolation;
- remote connectivity;
- session and conversation state;
- queues and coordination;
- user interfaces;
- organizational security and collaboration.

An individual developer on user-owned infrastructure does not need to rebuild that entire stack. A smaller product can preserve the useful transformation while delegating solved infrastructure to existing open-source tools.

## Product thesis

> For developers who use coding-agent CLIs and own underused compute, we turn that compute into isolated, persistent project homes that can be controlled from anywhere, without requiring a hosted agent platform or forcing the developer to operate the underlying networking, terminal, and VM tools directly.

The visible transformation is:

```text
Before
------
Agents compete with local work
Projects share one mutable environment
Remote access requires infrastructure knowledge
Sessions and development servers are difficult to rediscover

After
-----
Each project has a persistent isolated home
Compute runs on a chosen remote machine
Agent and shell sessions survive client disconnection
A named route exposes the selected project locally
Humans and agents use the same small CLI
```

## Product model

The system is intentionally reduced to four primitives.

### Host

A machine capable of running or reaching isolated environments. The first host is a personal Mac. Future hosts may be Linux workstations, bare-metal servers, cloud VMs, or sandbox providers.

### Computer

A persistent, isolated development environment associated with a project. In the first implementation, a computer is a SmolVM-backed Linux microVM with its own filesystem, processes, ports, dependencies, and lifecycle.

A computer is not an agent conversation and is not created for every prompt. It is a project home that can contain many shell and agent sessions over time.

### Session

A durable process inside a computer. A session may contain a shell, development server, test watcher, debugger, or coding agent. “Agent” and “subagent” are roles in a workflow, not different infrastructure objects.

### Route

A connection from a client-side port to a port inside one selected computer. Two micro-computers may both run an application on their own port 3000 because they have separate network namespaces. The user can expose them concurrently on different client ports or switch client port 3000 between them.

## Representative workflow

```bash
# Register an existing machine once.
micropc host add home --address home-mac.tailnet.ts.net --user me

# Create a persistent project environment.
micropc create home/my-app --repo github.com/example/my-app

# Start an ordinary shell or agent session.
micropc shell home/my-app
micropc agent start home/my-app --backend codex

# Disconnect and return later.
micropc session list home/my-app
micropc attach home/my-app <session>

# Run a development server in the computer and inspect it locally.
micropc route use home/my-app 3000
# Open http://localhost:3000 on the work Mac.

# Release compute without deleting the environment.
micropc sleep home/my-app
micropc wake home/my-app

# Deletion is separate and explicit.
micropc destroy home/my-app --force
```

The `micropc` command name and this workflow are the MVP product contract. Amp Orbs and Factory Droid Computers are product inspirations only; neither “orb” nor “droid” is a MicroPC object or command name.

## Why persistence is central

Ephemeral environments are valuable for clean, one-off work. They are less attractive when a developer repeatedly returns to the same project and must reconstruct dependencies, databases, credentials, caches, and agent context.

A persistent computer keeps filesystem state across sleep and wake. It does not initially promise live process hibernation. When a computer sleeps:

- files, installed dependencies, repositories, and backend-owned conversation files remain;
- running processes stop unless the underlying engine later supports memory suspension;
- an agent conversation resumes only through that agent backend’s native resume mechanism.

This contract is smaller and more honest than “resume anything,” while removing the repeated environment setup that causes most friction.

## Why microVMs

The product needs separate project filesystems, process trees, package installations, and port namespaces. There are three broad execution choices:

| Choice | Strength | Limitation for this product |
| --- | --- | --- |
| Host process | Minimal overhead and maximum compatibility | Weak separation; projects and agents share the host environment |
| Container | Fast, familiar OCI workflow and namespace isolation | Containers normally share a kernel; privileged or highly autonomous workloads widen the trust boundary |
| MicroVM | Separate guest kernel and hardware virtualization boundary with VM-like project state | More lifecycle and networking machinery than a process or container |

Docker documents namespace-based container isolation in its [engine security overview](https://docs.docker.com/engine/security/). Firecracker describes microVMs as combining hardware-virtualized isolation with container-like speed and flexibility in its [project documentation](https://github.com/firecracker-microvm/firecracker).

MicroVMs are selected because a computer is intended to behave like a small computer, not merely a packaged process. The project will not implement virtualization. It will initially use [SmolVM](https://github.com/smol-machines/smolvm), which already provides persistent machines, OCI images, networking, and macOS/Linux support.

## What is unique

The project occupies the layer between low-level sandbox engines and full cloud-agent platforms.

| Alternative | What it primarily provides | Difference from this project |
| --- | --- | --- |
| SSH + Tailscale + `tmux` | Reachability, encrypted commands, durable terminals | We turn separate primitives into project-aware hosts, micro-computers, sessions, routes, and agent workflows |
| SmolVM or Microsandbox | Local microVM creation and execution | We add remote multi-host control, persistent project identity, sessions, routes, and agent-facing automation |
| OpenHands | An agent SDK, tools, conversations, workspaces, agent server, and applications | We do not replace the agent; existing CLI agents run unchanged inside project environments |
| Amp Orbs | Hosted remote machines integrated with Amp threads | We are self-hosted, agent-agnostic, and intended for user-owned or user-chosen infrastructure |
| Factory Droid Computers | Persistent managed or BYOM computers integrated with Droid and Factory’s control plane | We expose an open control layer and replaceable environment engine without requiring Factory’s agent or service |
| Hosted cloud-agent infrastructure | Public control plane, provisioning, queues, sandboxes, session state, and collaboration | The first version uses a private path to a personal host and deliberately avoids production multi-tenancy |

The value is not that the project boots a VM. The value is that a developer can treat many isolated environments across chosen machines as one understandable agent workspace system.

## Design principles

### 1. Compose before implementing

Networking comes from Tailscale. Secure remote commands and tunnels come from SSH. Durable interactive processes come from `tmux`. Isolation and VM persistence come from SmolVM. Agent behavior and conversation state remain with the selected agent CLI.

The project builds the missing control experience rather than reimplementing those systems.

### 2. Agent-agnostic by construction

An agent is a command executed in a session. Backend adapters may improve launch, status, and resume behavior, but the core must not depend on one model provider, agent loop, or conversation format.

### 3. Persistent by default, disposable by choice

A project computer survives across sessions and sleeps without losing its disk. Later, `computer fork` may create disposable copies for parallel experiments. The default should optimize repeated real work rather than one-shot demos.

### 4. Human and agent use the same interface

Every important CLI operation should offer stable machine-readable output. An orchestrator may call the CLI to create a computer and launch another agent, but the core does not need a dedicated subagent or orchestration system.

### 5. Understandable in one evening

Package boundaries, state files, external commands, and lifecycle transitions should be explicit. The repository is an implementation and an educational explanation of personal agent infrastructure.

### 6. Abstractions are earned

SmolVM is the only MVP environment driver. Tailscale plus SSH is the only MVP connector. New provider interfaces should be extracted from a second working implementation rather than designed around imagined compatibility.

## MVP scope

### Core

- register and inspect one personal Mac host;
- create, list, wake, sleep, and destroy persistent SmolVM-backed micro-computers;
- initialize one repository inside a computer;
- run and reconnect to durable shell and agent sessions;
- list session status and output;
- route a client port to a selected computer port;
- provide machine-readable CLI output;
- diagnose missing Tailscale, SSH, SmolVM, and guest prerequisites.

### Supporting

- resource settings for CPU, memory, and disk;
- one documented base image;
- thin recipes for a small number of CLI agents;
- explicit file copy and Git-based result transfer;
- clear recovery behavior after client, host, or computer restart.

### Explicitly not in the MVP

- a new coding-agent loop;
- a universal conversation store;
- a custom VPN, relay, SSH implementation, hypervisor, or VM monitor;
- a hosted multi-tenant control plane;
- a general scheduler or automatic multi-host placement;
- live agent-to-agent messaging;
- automatic merge resolution;
- web, mobile, or collaborative interfaces;
- RBAC, enterprise policy, billing, or audit infrastructure;
- a plugin marketplace;
- task migration between running hosts;
- a promise to preserve running processes through VM sleep.

These omissions are part of the design. They keep the first proof focused on one question: does a persistent remote project computer improve an individual developer’s daily agent workflow?

## Success criteria

GitHub stars can measure attention, but not product value. The first evidence should be behavioral.

### Product proof

- A developer can go from installation to a remote computer without manually composing SSH, `tmux`, or forwarding commands.
- The developer can reuse the same project computer across multiple days without reinstalling its environment.
- Two isolated micro-computers can run development servers on guest port 3000 concurrently.
- The client can switch local port 3000 between those micro-computers.
- An agent process continues when the client disconnects.
- The user can resume a backend conversation after computer sleep when that backend supports native resume.

### Initial dogfood threshold

Before claiming product-market fit:

- use the system for at least seven working days;
- run at least ten real agent sessions;
- start at least three sessions while away from the host machine;
- reuse one project computer at least five times without rebuilding it;
- complete one real parallel workflow across two micro-computers;
- record every time the abstraction leaks and a direct SSH, `tmux`, or SmolVM command is required.

### Adoption evidence

After dogfooding, recruit five agent-heavy developers with unused personal or cloud compute. A meaningful early signal is that at least three complete setup and at least two return voluntarily for a second week.

## Highest-risk assumptions

| Assumption | Smallest test | Evidence that changes the plan |
| --- | --- | --- |
| Developers want persistent project environments more than fresh task sandboxes | Seven-day dogfood plus five targeted interviews | Most users prefer disposable environments and do not revisit computer state |
| Existing tools can be composed into a coherent UX | End-to-end SmolVM/Tailscale/SSH/tmux spike | Routine tasks require users to understand the underlying tools |
| MicroVM overhead is acceptable on personal Macs | Run two real project micro-computers concurrently | Memory, disk, or startup costs make the home-machine wedge impractical |
| Agent-native resume is sufficient | Test Codex, Droid, and Pi sleep/wake flows | Conversation recovery requires a product-owned state layer |
| A CLI can serve both humans and agents | Have an orchestrator consume only `--json` output | Automation requires unstable text scraping or backend-specific control APIs |

## Longer-term direction

If the Mac-first workflow proves useful, the same model can extend through concrete implementations:

- Linux and bare-metal hosts;
- EC2 or other persistent cloud machines;
- E2B, Daytona, or custom sandbox providers;
- alternate connectors and a browser-compatible control plane;
- computer snapshots and forks;
- explicit artifact exchange;
- opt-in agent-to-agent continuation;
- provider and recipe packages maintained by the community.

The aim is not to become a hosted cloud platform by default. It is to expose the smallest open set of primitives needed to build a personal or community-defined agent workspace system.

## References

- [Amp: Agents in Orbs](https://ampcode.com/news/agents-in-orbs)
- [Amp: From Agent to Agent](https://ampcode.com/news/from-agent-to-agent)
- [Factory: Droid Computers](https://factory.ai/news/droid-computers)
- [Factory: Bring Your Own Machine](https://docs.factory.ai/cli/features/droid-computers-byom)
- [Pi: What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Ramp Inspect on Modal](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal)
- [OpenHands architecture overview](https://docs.openhands.dev/sdk/arch/overview)
- [OpenHands workspace architecture](https://docs.openhands.dev/sdk/arch/workspace)
- [Tailscale: How Tailscale works](https://tailscale.com/blog/how-tailscale-works)
- [SmolVM](https://github.com/smol-machines/smolvm)
- [Microsandbox](https://github.com/superradcompany/microsandbox)

Content derived from external sources has been paraphrased for compliance with licensing restrictions.
