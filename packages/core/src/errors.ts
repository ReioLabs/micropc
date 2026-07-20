export class MicroPcError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly exitCode: number;

  constructor(code: string, message: string, details?: unknown, exitCode = 1) {
    super(message);
    this.name = "MicroPcError";
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function asMicroPcError(error: unknown): MicroPcError {
  if (error instanceof MicroPcError) return error;
  return new MicroPcError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
}

export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new MicroPcError(code, message);
}
