# MicroPC Development Rules

These instructions apply to contributors and coding agents working in this repository.

If a `.codegraph/` directory exists at the repository root, use CodeGraph before text search when locating or understanding code. Do not create or refresh the index unless explicitly requested.

## Source of truth

- Read `docs/product.md` before changing user-facing behavior.
- Read `docs/architecture.md` before changing package ownership or external-tool boundaries.
- If implementation changes a documented contract, update the document in the same change.
- Amp Orbs and Factory Droid Computers are inspirations only. The project is MicroPC, the CLI is `micropc`, and the domain primitive is a computer.

## Architecture

- Keep `core` independent from shell, SSH, SmolVM, UI, and agent libraries.
- Pass subprocess arguments as arrays. Do not interpolate user input into shell strings.
- Keep SSH transport in `connector`, SmolVM translation in `driver-smolvm`, lifecycle orchestration in `host`, and rendering/composition in `cli`.
- Treat agent backends as command recipes. Do not add a product-owned conversation database or agent loop.
- Validate all data crossing RPC and persistence boundaries at runtime.
- Prefer direct modules over generic provider or plugin systems until a second implementation proves the abstraction.

## Code quality

- Use strict, erasable TypeScript. Do not use `any`, parameter properties, enums, namespaces, or dynamic imports.
- Keep dependencies pinned to exact versions and review lockfile changes as code.
- Preserve explicit error codes and actionable remediation.
- Avoid silent fallbacks, swallowed setup failures, unbounded output, and destructive implicit cleanup.
- Keep files focused. Split mixed transport, persistence, domain, and rendering responsibilities.

## Validation

After code changes, run:

```bash
npm run check
npm test
```

Before a release or packaging change, also run:

```bash
npm run pack:dry
```

The default suite must remain deterministic and credential-free. Mark real SmolVM/Tailscale/SSH validation separately and report exact versions and platforms.

## Git

- Do not commit unless the user explicitly asks.
- Stage explicit paths; never use `git add .` or `git add -A`.
- Do not use destructive worktree commands or discard unrelated changes.
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, or `chore:`.
