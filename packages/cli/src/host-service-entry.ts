import { asMicroPcError, MicroPcError } from "@micropc/core/errors.js";
import { parseHostRequest } from "@micropc/core/protocol.js";
import type { HostService } from "@micropc/host/service.js";
import { flag, parseArgs } from "./args.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

export async function runHostService(service: HostService, tokens: string[]): Promise<void> {
  try {
    const encoded = flag(parseArgs(tokens), "request");
    const text = encoded ? Buffer.from(encoded, "base64url").toString() : await readStdin();
    const request = parseHostRequest(parseJson(text));
    const data = await service.handle(request);
    if (!request.operation.endsWith("attach") && !(request.operation === "computer.exec" && request.interactive)) {
      console.log(JSON.stringify({ ok: true, data }));
    }
  } catch (error) {
    const value = asMicroPcError(error);
    console.log(
      JSON.stringify({ ok: false, error: { code: value.code, message: value.message, details: value.details } }),
    );
    process.exitCode = value.exitCode;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MicroPcError("INVALID_JSON", "Host request must be valid JSON");
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new MicroPcError("REQUEST_TOO_LARGE", "Host request exceeds the 1 MiB limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString();
}
