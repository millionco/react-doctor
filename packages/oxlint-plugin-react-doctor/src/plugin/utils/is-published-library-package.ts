import * as fs from "node:fs";
import * as path from "node:path";
import { findNearestPackageDirectory } from "./classify-package-platform.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";

interface PackageJsonPublishView {
  private?: unknown;
  peerDependencies?: Record<string, unknown>;
}

const cachedResultByPackageDirectory = new Map<string, boolean>();

// True when the nearest `package.json` describes a publishable library that
// declares `react` as a peer dependency — the shape of a shipped component
// library. Bundle-splitting decisions for such packages belong to the
// consuming application, not inside the library, so "ships to your users up
// front" advice is misdirected there. Apps (which mark `"private": true` and
// depend on react directly) are never classified as libraries.
export const isPublishedLibraryPackage = (filename: string | undefined): boolean => {
  if (!filename) return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  const packageJsonPath = path.join(packageDirectory, "package.json");
  recordContentProbe(packageJsonPath);
  const cached = cachedResultByPackageDirectory.get(packageDirectory);
  if (cached !== undefined) return cached;
  let result = false;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      const manifest: PackageJsonPublishView = parsed;
      result =
        manifest.private !== true &&
        typeof manifest.peerDependencies === "object" &&
        manifest.peerDependencies !== null &&
        "react" in manifest.peerDependencies;
    }
  } catch {
    result = false;
  }
  cachedResultByPackageDirectory.set(packageDirectory, result);
  return result;
};
