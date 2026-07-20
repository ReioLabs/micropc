# MicroPC

MicroPC turns machines you control into hosts for persistent, isolated project computers. Existing coding agents run unchanged inside SmolVM microVMs, durable work lives in `tmux`, and SSH over Tailscale carries commands and loopback development routes.

MicroPC is an early MVP. Its deterministic CLI journey is tested end to end, while real SmolVM/Tailscale acceptance still requires supported hardware and is tracked separately from the credential-free default suite.

## Why MicroPC

- Keep one persistent filesystem and dependency environment per project.
- Run shells, services, and agent CLIs without coupling MicroPC to one agent provider.
- Disconnect the client without terminating `tmux` sessions.
- Route a guest development port back to the current laptop.
- Use the same versioned JSON CLI interface from humans or automation.

MicroPC composes SmolVM, SSH, Tailscale, and `tmux`; it does not implement a hypervisor, VPN, SSH stack, terminal multiplexer, or coding agent.

## Requirements

Install Node.js 22.19+, [SmolVM](https://github.com/smol-machines/smolvm), SSH, and Tailscale on the host. Install Node.js and MicroPC on the client. The default Alpine image is bootstrapped with Bash, certificates, Git, OpenSSH, and `tmux`. Agent CLIs and their credentials remain an explicit per-computer setup step.

## Build from source

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm install --global ./packages/cli
micropc --help
```

Install the same MicroPC version on the client and host.

## Quick start

```bash
micropc host add home --address home-mac.tailnet.ts.net --user me
micropc host doctor home
micropc create home/my-app --repo https://github.com/example/my-app.git
micropc session start home/my-app --name dev -- npm run dev
micropc route open home/my-app 3000
```

Use `--json` on non-interactive commands for the versioned response envelope. Destruction requires `--force`.

Current SmolVM releases only change published ports while a machine is stopped. Opening or closing a new route therefore restarts that computer and ends its running sessions. MicroPC reports those sessions as exited.

## Local development

`--address local` exercises the same host service without SSH:

```bash
micropc host add local --address local
micropc host doctor local
```

The E2E suite supplies an executable SmolVM contract double and validates two computers, durable session discovery, HTTP routing, route switching, sleep/wake, JSON output, and guarded destruction entirely through the CLI.

```bash
npm run check
npm test
npm run pack:dry
```

Use [docs/real-hardware-validation.md](docs/real-hardware-validation.md) for the external-infrastructure release gate.

## Repository

This is an npm workspace monorepo. Package responsibilities and dependency direction are documented in [docs/architecture.md](docs/architecture.md). Product boundaries and success criteria live in [docs/product.md](docs/product.md).

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before making broad changes. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## State and trust

- Client state: `~/.config/micropc/state.json` or `$MICROPC_HOME/state.json`
- Host state: `~/.local/share/micropc-host/state.json` or `$MICROPC_HOST_HOME/state.json`

State is runtime-validated and written with locks, restrictive permissions, file synchronization, and atomic replacement. MicroPC stores no SSH private keys or model credentials. Review [SECURITY.md](SECURITY.md) before forwarding credentials, mounts, sockets, or routes.

## License

Licensed under the [Apache License 2.0](LICENSE).
