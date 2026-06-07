import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";

// Read the declared `next` spec from any dependency section. All four are
// consulted so detection matches the framework gate, which also treats
// `peer`/`optional` `next` as Next.js. The `typeof` guard keeps a malformed
// non-string entry (e.g. `"next": 15`) from reaching `getLowestDependencyMajor`'s
// `.trim()` and aborting the scan.
const getNextjsDependencySpec = (packageJson: PackageJson): string | null => {
  const spec =
    packageJson.dependencies?.next ??
    packageJson.devDependencies?.next ??
    packageJson.peerDependencies?.next ??
    packageJson.optionalDependencies?.next;
  return typeof spec === "string" ? spec : null;
};

// The declared `next` package version spec, looked up in the root manifest and
// then each workspace package — the signal the `nextjs:15` capability gate
// keys off to silence `server-fetch-without-revalidate` on Next.js 15+. The
// workspace walk catches a monorepo whose root has no `next` but whose
// `apps/web` workspace runs Next.js, mirroring `findExpoVersion`; the caller
// resolves any returned `catalog:` reference via
// `resolveCatalogBackedDependencyVersion` so the major can be parsed.
export const findNextjsVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, getNextjsDependencySpec);
