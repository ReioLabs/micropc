import { MicroPcError } from "./errors.js";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function normalizeName(input: string, label = "name"): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!NAME_PATTERN.test(normalized)) {
    throw new MicroPcError("INVALID_NAME", `${label} must normalize to 1-63 lowercase letters, numbers, or hyphens`);
  }
  return normalized;
}

export function parseComputerRef(value: string): { hostName: string; computerName: string } {
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new MicroPcError("INVALID_COMPUTER_REF", `Expected <host>/<computer>, received '${value}'`);
  }
  return { hostName: normalizeName(parts[0], "host name"), computerName: normalizeName(parts[1], "computer name") };
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
