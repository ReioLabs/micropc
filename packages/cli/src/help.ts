export const HELP = `MicroPC — open, persistent micro-computers for coding agents

Usage: micropc <command> [options]

Hosts
  micropc host add <name> --address <tailscale-host|local> [--user <name>]
  micropc host list
  micropc host doctor <name>

Computers
  micropc create <host>/<computer> [--repo <url>] [--cpus 4] [--memory 8192]
  micropc list [host]
  micropc inspect <host>/<computer>
  micropc wake <host>/<computer>
  micropc sleep <host>/<computer>
  micropc destroy <host>/<computer> --force
  micropc exec <host>/<computer> -- <command...>
  micropc shell <host>/<computer>

Sessions and agents
  micropc session start <host>/<computer> --name <name> -- <command...>
  micropc session list <host>/<computer>
  micropc session output <host>/<computer> <session> [--lines 200]
  micropc session stop <host>/<computer> <session>
  micropc attach <host>/<computer> <session>
  micropc agent list
  micropc agent start <host>/<computer> --backend <id> [--prompt <text>]
  micropc agent resume <host>/<computer> <session>

Routes
  micropc route open <host>/<computer> <guest-port> [--local <port>]
  micropc route use <host>/<computer> <guest-port> [--local <port>]
  micropc route list
  micropc route close <route-id>

All non-interactive commands support --json. Set MICROPC_HOME and
MICROPC_HOST_HOME to relocate client and host state.`;
