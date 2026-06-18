import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";
import { getDependencySpec } from "./utils/get-dependency-spec.js";

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
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    getDependencySpec(packageJson, "next"),
  );
