# Real hardware validation

The default test suite proves MicroPC orchestration against an executable SmolVM contract double. It does not prove a specific SmolVM, macOS, Tailscale, SSH, or agent release. Run this checklist before calling a MicroPC release hardware-validated.

## Record the environment

Capture:

```bash
micropc --version
node --version
npm --version
smolvm --version
tmux -V
tailscale version
ssh -V
uname -a
```

Record the client and host operating-system versions, CPU architecture, SmolVM image digest, and agent CLI versions. Never include credentials, tailnet names, private addresses, or repository secrets in public logs.

## One-host lifecycle

From the client:

```bash
micropc host add validation --address <tailscale-host> --user <ssh-user>
micropc host doctor validation
micropc create validation/project-a
micropc exec validation/project-a -- sh -c 'printf validation > /workspace/project/proof.txt'
micropc sleep validation/project-a
micropc wake validation/project-a
micropc exec validation/project-a -- cat /workspace/project/proof.txt
```

Acceptance: diagnostics pass, lifecycle commands report the real driver state, and `proof.txt` survives sleep/wake.

## Session disconnection

```bash
micropc session start validation/project-a --name counter -- sh -c 'i=0; while true; do i=$((i+1)); echo $i; sleep 1; done'
micropc session output validation/project-a counter --lines 10
```

Disconnect the client network, wait, reconnect, and run `session output` again. Acceptance: the counter advanced while the client was disconnected.

## Two computers and route switching

Create `validation/project-b`. Start an HTTP service on guest port 3000 in each computer with distinguishable output.

```bash
micropc route use validation/project-a 3000 --local 3000
curl --fail http://127.0.0.1:3000
micropc route use validation/project-b 3000 --local 3000
curl --fail http://127.0.0.1:3000
```

Acceptance: both guests use port 3000 without collision; the client response switches from A to B; the route binds only to client and host loopback. Because current SmolVM port updates restart a machine, affected sessions must be reported as exited.

## Agent recipe

Install one supported agent CLI inside a computer, start it through `micropc agent start`, disconnect, and verify session status/output. Test native resume only when the agent version exposes the documented resume command.

## Cleanup

```bash
micropc route list
micropc destroy validation/project-a --force
micropc destroy validation/project-b --force
```

Acceptance: routes and driver machines are removed intentionally, while unrelated SmolVM machines and host files remain untouched.
