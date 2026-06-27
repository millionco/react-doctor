import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./workspaces.js";
import { getDependencySpec } from "./dependencies.js";

// The declared `expo` package version spec, looked up in the root manifest
// and then each workspace package — react-doctor's "is this an Expo
// project, and which SDK?" signal. Returns `null` when no package declares
// `expo`. The `expo` major tracks the Expo SDK release one-to-one
// (`expo@^51` ⇒ SDK 51), so callers parse the SDK major straight from this.
//
// Keyed off the `expo` package rather than `framework === "expo"` because
// `detectFramework` returns the first matching package, so a project
// declaring both `expo` and a web bundler (`vite` / `next`) classifies as
// the web framework yet is still an Expo project. The workspace walk also
// catches a web-rooted monorepo whose `apps/mobile` workspace targets Expo.
export const findExpoVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    getDependencySpec(packageJson, "expo"),
  );

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

export const SHOPIFY_FLASH_LIST_PACKAGE_NAME = "@shopify/flash-list";

export const findShopifyFlashListVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    getDependencySpec(packageJson, SHOPIFY_FLASH_LIST_PACKAGE_NAME),
  );
