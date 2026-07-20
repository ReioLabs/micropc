import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const packageNames = await readdir(resolve("packages"));
const manifests = [root];
for (const name of packageNames) {
  try {
    manifests.push(JSON.parse(await readFile(resolve("packages", name, "package.json"), "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const errors = [];
for (const manifest of manifests) {
  if (manifest.version !== root.version) {
    errors.push(`${manifest.name}: version ${manifest.version} does not match root ${root.version}`);
  }
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (name.startsWith("@micropc/") && version !== root.version) {
        errors.push(`${manifest.name}: ${section}.${name} must be ${root.version}`);
      }
      if (!name.startsWith("@micropc/") && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        errors.push(`${manifest.name}: ${section}.${name} must be pinned to an exact version, received ${version}`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Validated ${manifests.length - 1} workspace manifests at version ${root.version}.`);
}
