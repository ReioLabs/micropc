# Security Policy

MicroPC executes commands inside user-controlled microVMs and connects to user-controlled hosts over SSH. Security reports are evaluated against those explicit trust boundaries.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository and include:

- the affected version or commit;
- impact and the boundary that is crossed;
- reproducible steps or a minimal proof of concept;
- relevant host, guest, and connector configuration;
- known mitigations.

Maintainers will acknowledge a complete report, investigate it privately, and coordinate disclosure before publishing details.

## Trust model

MicroPC's MVP is single-user personal infrastructure:

- The local user account, registered SSH account, host operating system, Tailscale configuration, SSH configuration, hypervisor, SmolVM, and MicroPC host state are trusted.
- A computer runs behind a microVM boundary, but every forwarded capability expands its authority.
- Host directories are not mounted into computers by default.
- SSH and Tailscale credentials stay outside computers.
- Agent, Git, package-manager, and model credentials configured inside a computer are accessible to processes in that computer.
- Routes bind to loopback by default. Publishing or proxying them elsewhere changes the boundary.

MicroPC does not claim hostile multi-tenant isolation, a hardened public control plane, secret management, or protection from a compromised trusted host account.

## In scope

- command or option injection that escapes the intended guest boundary;
- authentication or authorization bypass in MicroPC's SSH host-service transport;
- unintended host filesystem or credential exposure caused by MicroPC defaults;
- routes binding beyond loopback without explicit user action;
- state-file vulnerabilities that cross an operating-system permission boundary;
- vulnerabilities in distributed MicroPC code with demonstrated reachability.

## Out of scope

- code execution intentionally requested with `micropc exec`, shell, session, or agent commands;
- malicious code, agents, repositories, images, or dependencies running inside a computer;
- compromise requiring prior write access to the trusted user account, MicroPC state, SSH configuration, or executable search path;
- vulnerabilities solely in SmolVM, SSH, Tailscale, `tmux`, an agent CLI, or an OCI image; report those upstream;
- denial of service from workloads intentionally given the host's resources;
- configurations that deliberately expose routes, credentials, mounts, or privileged services.

## Supported versions

Before the first stable release, only the latest commit on `main` receives security fixes. A version support table will be added with the first stable release.
