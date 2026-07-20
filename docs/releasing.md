# Releasing MicroPC

MicroPC uses lockstep versions across the private workspace packages and the public `micropc` package. Releases follow Semantic Versioning.

## Release gate

1. Update `CHANGELOG.md` and move relevant Unreleased entries into the new version.
2. Update the root and every workspace `package.json` to the same version; update internal `@micropc/*` dependency versions.
3. Refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
4. Run:

   ```bash
   npm ci --ignore-scripts
   npm run check
   npm test
   npm run pack:dry
   ```

5. Complete `docs/real-hardware-validation.md` on supported hardware and retain a sanitized result with exact versions.
6. Install the packed artifact outside the repository and verify `micropc --version`, `micropc --help`, and `micropc host list --json`.
7. Review the tarball contents and dependency audit.

## Publish

Publishing requires maintainer npm access and a protected GitHub release environment. Prefer npm trusted publishing with provenance rather than a long-lived npm token. Tag the exact reviewed commit as `v<version>`, publish the `micropc` workspace once, and create release notes from the immutable changelog section.

Do not publish private `@micropc/*` workspaces. They are bundled into the public CLI artifact.

Release automation should be added only after the repository URL, npm ownership, protected environment, and trusted-publishing relationship exist. Do not commit placeholder credentials or unverified publish workflows.
