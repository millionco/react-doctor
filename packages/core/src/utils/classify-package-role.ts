import * as fs from "node:fs";
import * as path from "node:path";

// "library" — the file ships as a published/consumable package: its nearest
//             `package.json` declares both `name` and `exports`, the modern
//             publish contract. App-only heuristics (components-in-render,
//             render-prop proliferation, …) are noise here because the
//             package's authors deliberately expose flexible primitives.
//             We do NOT infer "library" from a `packages/` directory:
//             monorepos routinely place applications there (e.g. an Electron
//             app at `packages/<name>-app`), and silencing app-only findings
//             in those is a false negative — caught via RDE on
//             `usebruno/bruno`'s `packages/bruno-app` (a private app with no
//             `exports` that the old directory heuristic wrongly silenced).
// "app"     — the file lives under an `apps/` directory: an application that
//             renders, not a library that exposes API.
// "unknown" — no nearest `package.json`, an unparseable manifest, or a
//             package without a publish contract. Callers treat "unknown"
//             like "app" (fire) so a missing classification never silences a
//             real finding.
export type PackageRole = "library" | "app" | "unknown";

// The nearest-`package.json` ancestor walk + safe-manifest read below are
// INTENTIONALLY duplicated with `oxlint-plugin-react-doctor`'s
// `plugin/utils/classify-package-platform.ts` — same rationale as
// `project-info/rn-metadata.ts`: this leaf lives in core's
// pipeline layer, the plugin's copy runs inside oxlint at lint time, and we
// keep them separate so each side stays decoupled from the other's bundle.
// Only the plumbing overlaps; the SIGNAL each reads differs (publish contract
// here vs. dependency cohort there). Keep the walk semantics in sync if either
// changes.

// Memoize by package directory (NOT filename): every file in a package shares
// the same answer and a single scan visits many files per package.
const cachedRoleByPackageDirectory = new Map<string, PackageRole>();
const cachedPackageDirectoryByFilename = new Map<string, string | null>();

const findNearestPackageDirectory = (filename: string): string | null => {
  if (!filename) return null;
  const fromCache = cachedPackageDirectoryByFilename.get(filename);
  if (fromCache !== undefined) return fromCache;

  let currentDirectory = path.dirname(filename);
  while (true) {
    const candidatePackageJsonPath = path.join(currentDirectory, "package.json");
    let hasPackageJson = false;
    try {
      hasPackageJson = fs.statSync(candidatePackageJsonPath).isFile();
    } catch {
      hasPackageJson = false;
    }
    if (hasPackageJson) {
      cachedPackageDirectoryByFilename.set(filename, currentDirectory);
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      cachedPackageDirectoryByFilename.set(filename, null);
      return null;
    }
    currentDirectory = parentDirectory;
  }
};

interface PackageManifestView {
  name?: unknown;
  exports?: unknown;
  private?: unknown;
}

const readManifest = (packageJsonPath: string): PackageManifestView | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) return parsed as PackageManifestView;
    return null;
  } catch {
    return null;
  }
};

// A published library declares `name` + `exports` (its consumption contract)
// and is NOT `private`. The `private !== true` guard matters: applications
// frequently set `"private": true` AND declare a niche `exports` map for
// internal path aliases (e.g. appsmith's `app/client` ships
// `exports: { "./lib/*": … }`), and treating those as libraries silenced
// real app diagnostics — caught via RDE.
const hasPublishContract = (manifest: PackageManifestView): boolean =>
  typeof manifest.name === "string" &&
  manifest.name.length > 0 &&
  manifest.exports !== undefined &&
  manifest.exports !== null &&
  manifest.private !== true;

// Returns "app" when `packageDirectory` sits under an `apps/` directory — an
// explicit application signal. We intentionally do NOT treat a `packages/`
// ancestor as a library signal (apps live there too); only the publish
// contract decides "library". "app" and "unknown" behave identically for
// gating (both fire), so this is informational rather than load-bearing.
const classifyByDirectoryCohort = (packageDirectory: string): PackageRole | null => {
  let current = packageDirectory;
  while (true) {
    if (path.basename(current) === "apps") return "app";
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

// Clears the memoized classifications so a long-running consumer (watch mode,
// agentic CLI, repeated `diagnose()`) re-reads manifests that changed between
// calls. Wired into `clearCaches()` alongside the other module-scope caches.
export const clearPackageRoleCache = (): void => {
  cachedRoleByPackageDirectory.clear();
  cachedPackageDirectoryByFilename.clear();
};

export const classifyPackageRole = (filename: string | undefined): PackageRole => {
  if (!filename) return "unknown";
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return "unknown";

  const cached = cachedRoleByPackageDirectory.get(packageDirectory);
  if (cached !== undefined) return cached;

  const manifest = readManifest(path.join(packageDirectory, "package.json"));
  let result: PackageRole;
  if (manifest && hasPublishContract(manifest)) {
    result = "library";
  } else {
    result = classifyByDirectoryCohort(path.dirname(packageDirectory)) ?? "unknown";
  }
  cachedRoleByPackageDirectory.set(packageDirectory, result);
  return result;
};
