# Contributing to MicroPC

MicroPC welcomes bug reports, design discussion, documentation improvements, tests, and focused code contributions.

## Start with the product boundary

Read [docs/product.md](docs/product.md) and [docs/architecture.md](docs/architecture.md) before proposing architecture. MicroPC composes SmolVM, SSH, Tailscale, and `tmux`; it does not reimplement them. New abstractions should be justified by a second working implementation or a demonstrated limitation.

For substantial behavior changes, open an issue first. Describe the user problem, smallest useful behavior, compatibility impact, and validation plan.

## Development setup

Requirements:

- Node.js 22.19 or newer;
- npm 10 or newer;
- macOS or Linux;
- SmolVM only for real-infrastructure tests.

```bash
npm ci --ignore-scripts
npm run check
npm test
```

The deterministic E2E suite uses a SmolVM contract double. It does not require a hypervisor, Tailscale, SSH server, or paid agent API.

## Workspace map

- `packages/core`: domain types, validation, lifecycle rules, and RPC contracts;
- `packages/process`: bounded argument-array subprocess execution;
- `packages/storage`: locked, validated, atomic JSON persistence;
- `packages/driver-smolvm`: SmolVM command translation;
- `packages/host`: host-side lifecycle orchestration;
- `packages/connector`: local and SSH transport plus tunnels;
- `packages/agents`: thin agent command recipes;
- `packages/cli`: public CLI composition, rendering, and hidden host helpers;
- `tests`: unit, boundary, and subprocess-level E2E tests.

Dependencies point inward toward `core`. The SmolVM driver must not know about SSH or CLI rendering. The connector must not own computer lifecycle. Agent recipes generate commands but do not own conversations.

## Quality bar

Before opening a pull request:

```bash
npm run check
npm test
npm run pack:dry
```

Keep direct dependencies pinned to exact versions. Use argument arrays for subprocesses; never interpolate user input into a shell command. Add a regression test for bug fixes. Update product or architecture documentation when behavior or boundaries change.

Real SmolVM changes should also follow [docs/real-hardware-validation.md](docs/real-hardware-validation.md) and report the exact SmolVM version and host platform. Never require credentials or paid APIs in the default test suite.

## Pull requests

Keep pull requests focused and explain:

- what user-visible behavior changes;
- why the change belongs in MicroPC rather than an upstream tool;
- security or compatibility implications;
- commands and environments used for validation.

By contributing, you agree that your contribution is licensed under Apache License 2.0.

Maintainers should follow [docs/releasing.md](docs/releasing.md) for releases.
