import { type JsonEnvelope, SCHEMA_VERSION } from "@micropc/core/domain.js";

export function renderSuccess(command: string, data: unknown, json: boolean): void {
  if (json) {
    const envelope: JsonEnvelope = { schemaVersion: SCHEMA_VERSION, ok: true, command, data };
    console.log(JSON.stringify(envelope));
    return;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log("No results.");
      return;
    }
    for (const item of data) console.log(formatLine(item));
    return;
  }
  if (typeof data === "object" && data !== null && "output" in data) {
    process.stdout.write(String((data as { output: unknown }).output));
    return;
  }
  console.log(formatLine(data));
}

function formatLine(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const record = value as Record<string, unknown>;
  if (record.name && record.status) return `${record.name} — ${record.status}`;
  if (record.name) return String(record.name);
  if (record.id && record.clientPort) return `${record.id} — http://localhost:${record.clientPort}`;
  return JSON.stringify(value, null, 2);
}
