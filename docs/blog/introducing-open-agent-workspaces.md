# A Cloud Agent Is a Computer You Can Come Back To

> Build-in-public MVP post
>
> Subtitle: Deriving an open agent workspace from first principles

I have two Macs.

One travels with me to the office and coffee shops. The other is more powerful and spends most of its life sitting at home.

Meanwhile, I run coding agents like Codex and Droid on the Mac in front of me. Long sessions consume CPU and memory, development servers compete for ports, and every parallel task adds another repository checkout and another terminal I need to remember. The expensive computer at home remains idle.

The obvious answer is remote development. Install a private network, configure SSH, learn enough `tmux` to keep processes alive, create VMs or containers, forward ports, and write scripts to remember which project runs where.

All of those pieces already exist. The problem is that I do not want operating those pieces to become another hobby.

Hosted cloud agents solve a version of this problem. They let you start work remotely, close your laptop, and return later. But they usually bring an agent, a sandbox model, a control plane, and an opinionated workflow as one product. I do not want to replace the coding agents I already use or move every project into somebody else’s platform. I want to turn computers I already control into good homes for those agents.

That led me to a different question:

> What is the smallest useful cloud-agent infrastructure for one developer?

This is the design argument that guided the first MicroPC implementation. The CLI and deterministic end-to-end journey now exist; publishing the argument alongside them keeps the assumptions visible instead of presenting implementation as proof of product value.

## First, separate the agent from the computer

“Cloud agent” sounds like one thing. It is several systems packaged together.

A production cloud-agent platform may contain:

1. an agent loop and model integration;
2. an execution environment;
3. isolation for untrusted code;
4. workspace and conversation persistence;
5. environment provisioning and scheduling;
6. remote identity and networking;
7. command, file, and event streaming;
8. port or browser previews;
9. queues, collaboration, and policy;
10. interfaces such as web, mobile, IDE, Slack, or CLI.

These pieces are included for good reasons. A hosted service must create environments for many users, keep tenants separate, authenticate clients on the public internet, route every request to the right sandbox, recover coordination state, meter resources, and support several interfaces.

Ramp’s Inspect is a useful example of the full production shape. According to [Modal’s architecture description](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal), each session gets a complete sandboxed development environment. Prepared filesystem snapshots reduce startup time, while cloud queues and shared coordination state route prompts from several clients into the right running session. That is the right kind of machinery when hundreds of people need effectively elastic parallel computers.

OpenHands exposes a similar separation in an open agent platform. Its [architecture](https://docs.openhands.dev/sdk/arch/overview) includes agents, conversations, tools, events, workspaces, and an agent server. Its [remote agent-server model](https://docs.openhands.dev/sdk/guides/agent-server/overview) uses HTTP and WebSocket APIs to stream events and proxy command and file operations into isolated environments.

But I am starting with one developer and one underused computer. That changes the design.

I do not need to build an agent loop; Codex, Droid, Pi, Claude Code, and other terminal agents already exist. I do not need a multi-tenant scheduler; I know which machine I want to use. I do not need a public control plane; my two computers can join a private network. I do not need a universal conversation database; each agent already has its own resume semantics.

Removing those requirements reveals a much smaller system.

## Four primitives

The product can be described with four nouns.

### Host

A computer capable of running isolated environments. My first host is the Mac at home. A future host might be a Linux workstation, EC2 instance, bare-metal server, or a sandbox provider.

### Computer

A persistent isolated project environment. It has its own filesystem, processes, dependencies, ports, and lifecycle.

The project is named **MicroPC**, its CLI is **`micropc`**, and this primitive is a micro-computer (shortened to computer). The name reflects the open environment layer shared by the ideas behind Factory Droid Computers and Amp Orbs without adopting either product’s nouns or binding MicroPC to either agent.

### Session

A durable process inside a computer. A shell is a session. A development server is a session. Codex is a session. If one agent asks the CLI to start another agent in another computer, that second process may play the role of a subagent, but the infrastructure does not need a special “subagent system.”

### Route

A mapping from a port on the computer in front of me to a port inside one computer. A route lets me run an application remotely and inspect it through `localhost` on my work Mac.

The whole model is:

```text
Host → Computer → Session
          └→ Route
```

Higher-level behavior composes from those primitives:

```text
background agent = agent session in a remote computer
parallel work     = sessions in several micro-computers
project preview   = route to a computer port
persistence       = computer disk plus backend conversation files
delegation        = an agent invoking the same micropc CLI I use
```

## The products that changed my thinking

[Amp Orbs](https://ampcode.com/news/agents-in-orbs) show how behavior changes when a fresh remote machine is as easy to start as a local agent thread. Amp later described agents spawning work across local machines and orbs and exchanging messages and files in [From Agent to Agent](https://ampcode.com/news/from-agent-to-agent).

The important lesson is not “add a multi-agent framework.” It is that making isolated compute addressable through the agent’s existing interface lowers the cost of delegation. People use parallel agents more when creating their environments is no longer a separate infrastructure project.

[Factory Droid Computers](https://factory.ai/news/droid-computers) emphasize a complementary idea: persistence. Their managed computers can pause while idle and return with environment state, while [Bring Your Own Machine](https://docs.factory.ai/cli/features/droid-computers-byom) connects a user-managed computer outbound through Factory’s relay. That validates both halves of my problem: agents benefit from a stable home, and developers want to use machines they already manage.

My proposed wedge combines those ideas differently:

- persistent project environments rather than a fresh machine for every prompt;
- user-owned compute before managed cloud compute;
- any terminal coding agent rather than one integrated agent;
- an open CLI before a hosted control plane;
- existing infrastructure primitives before custom distributed systems.

## Why not simply self-host OpenHands?

OpenHands is open source and can run agents in local, Docker, or remote workspaces. If I wanted the OpenHands agent model, tools, conversations, server, and interfaces, self-hosting it would be a sensible option.

That is not the problem I am trying to solve.

I want the environment layer underneath agents to become reusable. The environment should not care whether the process inside it is Codex, Droid, Pi, a shell, a test watcher, or an orchestrator written next year.

The distinction is:

```text
OpenHands
agent platform → workspace abstraction

This project
workspace product → arbitrary agent process
```

This smaller scope gives up useful OpenHands capabilities. There is no universal event stream, conversation object, tool API, or web application. In return, the project can remain agent-agnostic and let every backend preserve its native behavior.

## Why not simply use SmolVM?

This project should use SmolVM.

[SmolVM](https://github.com/smol-machines/smolvm) already creates persistent microVMs, starts and stops them, executes commands, supports OCI images, and provides networking. [Microsandbox](https://github.com/superradcompany/microsandbox) provides a related local-first microVM runtime with several language SDKs.

Reimplementing either would be wasteful.

But a VM engine answers a lower-level question:

> How do I run an isolated machine on this host?

The product I want must answer:

> Which project environment is on which host, how do I reach it remotely, which sessions are running, and how do I expose the right application to the laptop in front of me?

If this project only renames `smolvm machine create`, it has no reason to exist. Its value begins with remote host registration, persistent project identity, durable agent sessions, route switching, diagnostics, and a stable interface usable by both humans and agents.

SmolVM should be the first replaceable engine, not a competitor.

## Why a microVM at all?

The simplest implementation would run every agent as a process on the home Mac. That works until two projects need incompatible dependencies, two agents modify the same files, or an autonomous process receives more host access than intended.

A container improves separation. Linux namespaces isolate process views and resources, while OCI images make environments reproducible. Docker explains this namespace model in its [engine security overview](https://docs.docker.com/engine/security/).

A microVM goes one boundary further: each environment receives its own guest kernel behind hardware virtualization. Projects get separate filesystems, process trees, package state, and port namespaces. Firecracker describes the goal as VM-style isolation with container-like efficiency in its [project documentation](https://github.com/firecracker-microvm/firecracker).

For this product, the options look like this:

| Execution model | Why choose it | Why I am not choosing it first |
| --- | --- | --- |
| Host process | Smallest and most compatible | Projects and autonomous agents share the host environment |
| Container | Fast, familiar, reproducible | Usually shares a kernel and feels more like a packaged process than a persistent computer |
| MicroVM | Separate kernel, computer-like lifecycle, independent ports and disks | Requires more lifecycle and network integration |

The extra machinery is justified because the product primitive is a persistent little computer. The project will use an existing engine instead of building the machinery itself.

A microVM is not a magic security box. Mounting a host directory, forwarding an SSH agent, injecting credentials, enabling the network, or opening a port grants capabilities across the boundary. The first release is personal single-user infrastructure, not a hardened hostile multi-tenant service.

## Two projects, one port

Suppose two micro-computers each run `npm run dev` on port 3000.

```text
home Mac
├── project-a computer → guest localhost:3000
└── project-b computer → guest localhost:3000
```

There is no conflict because each microVM has a separate network namespace.

From my work Mac I can expose both on different ports:

```bash
micropc route open home/project-a 3000 --local 3001
micropc route open home/project-b 3000 --local 3002
```

Or switch one familiar port:

```bash
micropc route use home/project-a 3000
# http://localhost:3000 shows project A

micropc route use home/project-b 3000
# http://localhost:3000 now shows project B
```

That small interaction expresses the larger product idea: compute and storage live remotely, while control and validation stay on the device in front of me.

## Networking without inventing networking

Remote systems need reachability, identity, transport, and logical routing.

For the first version:

- Tailscale provides private reachability and NAT traversal.
- SSH provides authenticated commands, interactive terminals, file transfer, and tunnels.
- the product maps a project name to the correct SmolVM environment.

```text
work Mac
   │ SSH over Tailscale
   ▼
home Mac
   │ local SmolVM control
   ├── project-a computer
   └── project-b computer
```

The guest VMs do not need to join Tailscale. The home Mac is the entry point.

This is different from a hosted cloud-agent control plane. A hosted client normally connects to a public HTTPS or WebSocket API. The service authenticates the user, provisions or locates a sandbox, queues work, stores coordination state, and proxies streams. Tailscale plus SSH instead gives my client a private path to a machine I already trust.

Tailscale’s [architecture overview](https://tailscale.com/blog/how-tailscale-works) explains how its coordination and encrypted data plane handle peer discovery, NAT traversal, and relay fallback. Rebuilding that would turn this project into a networking product. I would rather depend on it first and replace it only when user evidence requires a different connector.

## Persistence without pretending to resume everything

“Persistent” can mean three different things:

1. **Environment state:** files, dependencies, databases, caches, and credentials.
2. **Process state:** running shells, agents, and servers.
3. **Conversation state:** model messages and backend checkpoints.

The first version owns only clear contracts:

- a computer disk survives sleep and wake;
- `tmux` keeps processes alive when only the client disconnects;
- sleeping or powering off a computer may stop its processes;
- an agent conversation resumes only through the backend’s native mechanism.

I do not want to invent a universal conversation database for tools with different state formats. Keeping their files and invoking their resume commands is enough to test the workflow.

## The CLI is also the orchestration API

A human might run:

```bash
micropc agent start home/my-app --backend codex
```

An orchestrator agent can run the same command with structured output:

```bash
micropc agent start home/my-app \
  --backend codex \
  --prompt "Investigate issue #142 and commit a proposed fix" \
  --json
```

That does not make every session a subagent. It means the primitive composes. The parent may start work, poll status, fetch a commit, and decide what to do next.

Git should carry code changes before the project invents a file synchronization protocol. Explicit copy can carry artifacts. A general live message bus can wait until a demonstrated workflow cannot be expressed through commands, files, and backend-native continuation.

## What I desperately do not want to build

This list matters more than the roadmap.

The first version will not contain:

- a new coding agent;
- a universal conversation format;
- a custom VPN or NAT traversal protocol;
- a custom SSH implementation;
- a hypervisor or microVM monitor;
- a production cloud scheduler;
- a hosted multi-tenant control plane;
- live multiplayer collaboration;
- a web or mobile UI;
- organization policy, RBAC, billing, or audit systems;
- an orchestration language;
- automatic merge resolution;
- a plugin marketplace;
- transparent migration of running VMs;
- a claim that every process survives VM sleep.

Each omission has a reason.

Hosted platforms need public control planes because their users cannot join the provider’s private network. Multi-user products need queues and durable coordination because many clients can modify one session. Enterprise systems need policy and audit controls because infrastructure crosses trust boundaries. Agent platforms need conversation models because they own the agent loop.

A personal agent workspace on a user-owned machine does not inherit those requirements automatically.

Pi’s creator summarized his philosophy as building only what he needed in [What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/). The transferable lesson is not to copy Pi’s feature list. It is to search for primitives that make dedicated features unnecessary.

For this project:

- an agent is a command;
- a background job is a session;
- a subagent is another agent session invoked by a caller;
- a preview is a route;
- persistent workspace state is a microVM disk;
- code exchange is Git;
- remote access is SSH over an existing private network.

That is the standard I want every proposed feature to beat.

## The first proof

The first milestone is intentionally unglamorous.

1. Create two persistent SmolVM environments on the home Mac.
2. Put a real project in each.
3. Run a different coding-agent session in each.
4. Disconnect the work Mac and confirm both sessions continue.
5. Run development servers on guest port 3000 in both micro-computers.
6. Switch work-Mac `localhost:3000` between them.
7. Sleep and wake one environment without reinstalling it.
8. Resume an agent conversation where its backend supports it.

Then I will use it for seven working days and record every time I must bypass the abstraction with direct SSH, `tmux`, or SmolVM commands.

The project has not proved its value when the demo works once. It has proved something when I voluntarily use the home Mac for real work, return to the same project environments, and stop thinking about where the agents run.

## What comes later, if the premise survives

A validated computer model could support:

- Linux and bare-metal hosts;
- EC2 and persistent cloud VMs;
- E2B, Daytona, or custom sandbox drivers;
- computer snapshots and forks for parallel experiments;
- browser-compatible connectors;
- explicit artifact exchange;
- agent-to-agent continuation;
- community-maintained provider and agent recipes.

The architecture should leave those doors open. It should not build the rooms before anyone walks through the front door.

## The claim

The project is not an open-source clone of a full cloud-agent platform. It is not a new sandbox engine. It is not a prettier SSH command.

The claim is narrower:

> A small open control layer can turn machines you already own into persistent, isolated homes for any coding agent—and make those homes simple enough for both humans and agents to use as ordinary tools.

Now I need to find out whether that claim survives contact with daily work.

---

### References

- [Amp: Agents in Orbs](https://ampcode.com/news/agents-in-orbs)
- [Amp: From Agent to Agent](https://ampcode.com/news/from-agent-to-agent)
- [Factory: Droid Computers](https://factory.ai/news/droid-computers)
- [Factory: Bring Your Own Machine](https://docs.factory.ai/cli/features/droid-computers-byom)
- [Pi: What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Ramp Inspect on Modal](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal)
- [OpenHands architecture](https://docs.openhands.dev/sdk/arch/overview)
- [OpenHands remote agent server](https://docs.openhands.dev/sdk/guides/agent-server/overview)
- [Tailscale architecture](https://tailscale.com/blog/how-tailscale-works)
- [SmolVM](https://github.com/smol-machines/smolvm)
- [Microsandbox](https://github.com/superradcompany/microsandbox)
- [Docker engine security](https://docs.docker.com/engine/security/)
- [Firecracker](https://github.com/firecracker-microvm/firecracker)

Content derived from external sources has been paraphrased for compliance with licensing restrictions.
