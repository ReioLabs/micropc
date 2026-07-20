import type { ComputerStatus } from "./domain.js";
import { MicroPcError } from "./errors.js";

const allowed: Record<ComputerStatus, ComputerStatus[]> = {
  provisioning: ["running", "error"],
  running: ["sleeping", "error"],
  sleeping: ["running", "error"],
  error: ["running", "sleeping"],
};

export function assertTransition(from: ComputerStatus, to: ComputerStatus): void {
  if (!allowed[from].includes(to)) {
    throw new MicroPcError("INVALID_TRANSITION", `Cannot transition a computer from ${from} to ${to}`);
  }
}
