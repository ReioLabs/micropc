import { MicroPcError } from "./errors.js";

const SSH_USER = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;
const SSH_ADDRESS = /^[a-zA-Z0-9][a-zA-Z0-9.:%_-]*$/;

export function validateSshEndpoint(user: string, address: string): void {
  if (!SSH_USER.test(user)) {
    throw new MicroPcError(
      "INVALID_SSH_USER",
      "SSH user may contain only letters, numbers, dots, underscores, and hyphens",
    );
  }
  if (!SSH_ADDRESS.test(address)) {
    throw new MicroPcError(
      "INVALID_SSH_ADDRESS",
      "SSH address must be a hostname or IP address without whitespace or options",
    );
  }
}
