import * as fs from "node:fs";
import * as path from "node:path";
import {
  isProbeRecorderActive,
  recordContentProbe,
  recordExistenceProbe,
} from "./cross-file-probe-recorder.js";

// The single owner of the nearest-package.json machinery every manifest
// consumer (`classify-package-platform`, `is-inside-node-cli-package`,
// `is-published-library-package`) shares: the ancestor directory walk, the
// probe recording, and the caches. Consolidating here means one cache to
// invalidate per scan instead of one copy per predicate.

// The manifest shape the consumers consult. Only the fields a predicate or
// classifier reads are declared; unread fields stay unknown.
export interface PackageManifest {
  bin?: unknown;
  name?: unknown;
  main?: unknown;
  module?: unknown;
  exports?: unknown;
  workspaces?: unknown;
  private?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  source?: unknown;
  // Metro's resolution key — libraries that ship an RN-only entry
  // point declare this field at the manifest root (string path) so
  // Metro picks it over `main` / `module`. Treated as a strong
  // RN-only signal for the owning package.
  "react-native"?: unknown;
}

// The lookup is read-only: we walk the directory tree from the file's
// location up to the filesystem root, look for the nearest `package.json`,
// and cache by package directory. Memoizing the manifest by directory (NOT
// filename) is essential — every file inside a package shares the same
// answer, and oxlint visits many files per package per run.
//
// Both memos are sound only within one scan (the filesystem is treated as
// frozen while a scan runs). A long-lived host (the LSP server) must call
// `resetManifestCaches` at each scan start so a package.json created closer
// to a source file, or an edited manifest, is picked up by the next scan.
const cachedPackageDirectoryByFilename = new Map<string, string | null>();
const cachedManifestByPackageDirectory = new Map<string, PackageManifest | null>();

export const resetManifestCaches = (): void => {
  cachedPackageDirectoryByFilename.clear();
  cachedManifestByPackageDirectory.clear();
};

export const findNearestPackageDirectory = (filename: string): string | null => {
  if (!filename) return null;

  // The walk's outcome depends on EVERY ancestor probe (a package.json
  // appearing closer to the file re-anchors the classification), so a memo
  // hit regenerates the walk's existence probes LEXICALLY — the exact
  // candidate list is derivable from the filename and the memoized stop
  // directory without touching the filesystem
  // (see cross-file-probe-recorder.ts).
  const fromCache = cachedPackageDirectoryByFilename.get(filename);
  if (fromCache !== undefined) {
    if (isProbeRecorderActive()) {
      let probedDirectory = path.dirname(filename);
      while (true) {
        recordExistenceProbe(path.join(probedDirectory, "package.json"));
        if (probedDirectory === fromCache) break;
        const parentDirectory = path.dirname(probedDirectory);
        if (parentDirectory === probedDirectory) break;
        probedDirectory = parentDirectory;
      }
    }
    return fromCache;
  }

  let currentDirectory = path.dirname(filename);
  while (true) {
    const candidatePackageJsonPath = path.join(currentDirectory, "package.json");
    recordExistenceProbe(candidatePackageJsonPath);
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

// Parses the nearest `package.json` above `filename`. Returns `null` when no
// package directory exists or the manifest is unreadable / unparseable — no
// consumer distinguishes the two.
export const readNearestPackageManifest = (filename: string): PackageManifest | null => {
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return null;
  return readPackageManifest(packageDirectory);
};

export const readPackageManifest = (packageDirectory: string): PackageManifest | null => {
  const packageJsonPath = path.join(packageDirectory, "package.json");

  // Recorded BEFORE the memo lookup — every consumer's verdict is a pure
  // function of this one manifest's content, so the probe alone captures the
  // dependency while the memo stays warm (see cross-file-probe-recorder.ts).
  recordContentProbe(packageJsonPath);
  const cached = cachedManifestByPackageDirectory.get(packageDirectory);
  if (cached !== undefined) return cached;

  let manifest: PackageManifest | null = null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      manifest = parsed as PackageManifest;
    }
  } catch {
    manifest = null;
  }
  cachedManifestByPackageDirectory.set(packageDirectory, manifest);
  return manifest;
};
