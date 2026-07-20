import { rm } from "node:fs/promises";
import { resolve } from "node:path";

await Promise.all([
  rm(resolve("packages/cli/dist"), { recursive: true, force: true }),
  rm(resolve("packages/cli/LICENSE"), { force: true }),
  rm(resolve("packages/cli/README.md"), { force: true }),
]);
