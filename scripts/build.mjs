import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPackage = JSON.parse(await readFile(resolve(root, "packages/cli/package.json"), "utf8"));
const outfile = resolve(root, "packages/cli/dist/main.js");

await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, "packages/cli/src/main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.19",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "external",
  define: {
    __MICROPC_VERSION__: JSON.stringify(cliPackage.version),
  },
});
await chmod(outfile, 0o755);
await copyFile(resolve(root, "LICENSE"), resolve(root, "packages/cli/LICENSE"));
await copyFile(resolve(root, "README.md"), resolve(root, "packages/cli/README.md"));
