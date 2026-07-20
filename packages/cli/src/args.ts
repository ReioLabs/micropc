import { MicroPcError } from "@micropc/core/errors.js";

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
  command: string[];
}

const booleanFlags = new Set(["json", "force", "help", "version"]);

export function parseArgs(tokens: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  const separator = tokens.indexOf("--");
  const before = separator >= 0 ? tokens.slice(0, separator) : tokens;
  const command = separator >= 0 ? tokens.slice(separator + 1) : [];
  for (let index = 0; index < before.length; index += 1) {
    const token = before[index];
    if (!token) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    index += readOption(before, index, flags);
  }
  return { positionals, flags, command };
}

function readOption(tokens: string[], index: number, flags: Map<string, string | boolean>): number {
  const token = tokens[index];
  if (!token) throw new MicroPcError("INVALID_ARGUMENT", "Missing option");
  const [rawKey, inline] = token.slice(2).split("=", 2);
  if (!rawKey) throw new MicroPcError("INVALID_ARGUMENT", `Invalid option '${token}'`);
  if (flags.has(rawKey)) throw new MicroPcError("DUPLICATE_OPTION", `Option --${rawKey} may only be provided once`);
  if (inline !== undefined) {
    flags.set(rawKey, inline);
    return 0;
  }
  if (booleanFlags.has(rawKey)) {
    flags.set(rawKey, true);
    return 0;
  }
  const value = tokens[index + 1];
  if (!value || value.startsWith("--")) {
    throw new MicroPcError("OPTION_VALUE_REQUIRED", `Option --${rawKey} requires a value`);
  }
  flags.set(rawKey, value);
  return 1;
}

export function flag(args: ParsedArgs, name: string, fallback?: string): string | undefined {
  const value = args.flags.get(name);
  if (typeof value === "boolean") throw new MicroPcError("INVALID_ARGUMENT", `Option --${name} requires a value`);
  return value ?? fallback;
}

export function numberFlag(
  args: ParsedArgs,
  name: string,
  fallback?: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const raw = flag(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maximum)
    throw new MicroPcError("INVALID_NUMBER", `--${name} must be a positive integer up to ${maximum}`);
  return value;
}

export function assertAllowedFlags(args: ParsedArgs, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const name of args.flags.keys()) {
    if (!allowedSet.has(name)) throw new MicroPcError("UNKNOWN_OPTION", `Unknown option --${name}`);
  }
}

export function positional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positionals[index];
  if (!value) throw new MicroPcError("ARGUMENT_REQUIRED", `${label} is required`);
  return value;
}
