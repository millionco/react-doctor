import * as fs from "node:fs";
import * as path from "node:path";
import type { DependencyInfo, PackageJson, WorkspacePackage } from "../types/index.js";
import {
  EMPTY_DEPENDENCY_INFO,
  extractDependencyInfo,
  getDependencyDeclaration,
  hasReactDependency,
  resolveCatalogVersion,
} from "./dependencies.js";
import { isDirectory, isFile, readDirectoryEntries } from "./fs-utils.js";
import { findMonorepoRoot } from "./monorepo-root.js";
import { readPackageJson } from "./package-json.js";
import { isPackageJsonReactNativeAware } from "./rn-metadata.js";
import { parseReactMajor } from "./version.js";

interface ResolveWorkspaceDependencyVersionOptions {
  concreteVersion: string | null;
  packageName: string;
  rootDirectory: string;
  rootPackageJson: PackageJson;
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">;
  workspaceDirectory: string;
  workspacePackageJson: PackageJson;
}

const resolveWorkspaceDependencyVersion = ({
  concreteVersion,
  packageName,
  rootDirectory,
  rootPackageJson,
  sections,
  workspaceDirectory,
  workspacePackageJson,
}: ResolveWorkspaceDependencyVersionOptions): string | null => {
  const dependencyDeclaration = getDependencyDeclaration({
    packageJson: workspacePackageJson,
    packageName,
    sections,
  });
  if (!dependencyDeclaration.hasDeclaration) return null;

  return (
    concreteVersion ??
    resolveCatalogVersion(
      workspacePackageJson,
      packageName,
      workspaceDirectory,
      dependencyDeclaration.catalogReference,
    ) ??
    resolveCatalogVersion(
      rootPackageJson,
      packageName,
      rootDirectory,
      dependencyDeclaration.catalogReference,
    )
  );
};

const shouldReplaceReactVersion = (currentVersion: string | null, nextVersion: string): boolean => {
  if (!currentVersion) return true;

  const currentMajor = parseReactMajor(currentVersion);
  const nextMajor = parseReactMajor(nextVersion);

  if (currentMajor === null) return nextMajor !== null;
  if (nextMajor === null) return false;
  return nextMajor < currentMajor;
};

export const findReactInWorkspaces = (
  rootDirectory: string,
  packageJson: PackageJson,
): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { ...EMPTY_DEPENDENCY_INFO };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      const info = extractDependencyInfo(workspacePackageJson);
      const reactVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.reactVersion,
        packageName: "react",
        rootDirectory,
        rootPackageJson: packageJson,
        sections: ["dependencies", "peerDependencies", "devDependencies"],
        workspaceDirectory,
        workspacePackageJson,
      });
      const tailwindVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.tailwindVersion,
        packageName: "tailwindcss",
        rootDirectory,
        rootPackageJson: packageJson,
        sections: ["dependencies", "devDependencies", "peerDependencies"],
        workspaceDirectory,
        workspacePackageJson,
      });
      const zodVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.zodVersion,
        packageName: "zod",
        rootDirectory,
        rootPackageJson: packageJson,
        sections: ["dependencies", "devDependencies", "peerDependencies"],
        workspaceDirectory,
        workspacePackageJson,
      });

      if (reactVersion && shouldReplaceReactVersion(result.reactVersion, reactVersion)) {
        result.reactVersion = reactVersion;
      }
      if (tailwindVersion && !result.tailwindVersion) {
        result.tailwindVersion = tailwindVersion;
      }
      if (zodVersion && !result.zodVersion) {
        result.zodVersion = zodVersion;
      }
      if (info.framework !== "unknown" && result.framework === "unknown") {
        result.framework = info.framework;
      }

      const resultReactMajor = parseReactMajor(result.reactVersion);
      if (
        result.reactVersion &&
        result.tailwindVersion &&
        result.framework !== "unknown" &&
        resultReactMajor !== null &&
        resultReactMajor <= 17
      ) {
        return result;
      }
    }
  }

  return result;
};

export const getWorkspacePatterns = (rootDirectory: string, packageJson: PackageJson): string[] => {
  const pnpmPatterns = parsePnpmWorkspacePatterns(rootDirectory);
  if (pnpmPatterns.length > 0) return pnpmPatterns;

  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  if (packageJson.workspaces?.packages) {
    return packageJson.workspaces.packages;
  }

  const nxPatterns = getNxWorkspaceDirectories(rootDirectory);
  if (nxPatterns.length > 0) return nxPatterns;

  return [];
};

export const parsePnpmWorkspacePatterns = (rootDirectory: string): string[] => {
  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  if (!isFile(workspacePath)) return [];

  const content = fs.readFileSync(workspacePath, "utf-8");
  const patterns: string[] = [];
  let isInsidePackagesBlock = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "packages:") {
      isInsidePackagesBlock = true;
      continue;
    }
    if (isInsidePackagesBlock && trimmed.startsWith("-")) {
      patterns.push(trimmed.replace(/^-\s*/, "").replace(/["']/g, ""));
    } else if (isInsidePackagesBlock && trimmed.length > 0 && !trimmed.startsWith("#")) {
      isInsidePackagesBlock = false;
    }
  }

  return patterns;
};

const NX_PROJECT_DISCOVERY_DIRS = ["apps", "libs", "packages"];

export const getNxWorkspaceDirectories = (rootDirectory: string): string[] => {
  if (!isFile(path.join(rootDirectory, "nx.json"))) return [];

  const collected: string[] = [];
  for (const candidate of NX_PROJECT_DISCOVERY_DIRS) {
    const candidatePath = path.join(rootDirectory, candidate);
    if (!isDirectory(candidatePath)) continue;
    for (const entry of readDirectoryEntries(candidatePath)) {
      if (!entry.isDirectory()) continue;
      const projectDirectory = path.join(candidatePath, entry.name);
      if (
        isFile(path.join(projectDirectory, "project.json")) ||
        isFile(path.join(projectDirectory, "package.json"))
      ) {
        collected.push(`${candidate}/${entry.name}`);
      }
    }
  }
  return collected;
};

export const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (isDirectory(directoryPath) && isFile(path.join(directoryPath, "package.json"))) {
      return [directoryPath];
    }
    return [];
  }

  const wildcardIndex = cleanPattern.indexOf("*");
  const baseDirectory = path.join(rootDirectory, cleanPattern.slice(0, wildcardIndex));
  const suffixAfterWildcard = cleanPattern.slice(wildcardIndex + 1);

  if (!isDirectory(baseDirectory)) {
    return [];
  }

  const resolved: string[] = [];
  for (const entry of readDirectoryEntries(baseDirectory)) {
    const entryPath = path.join(baseDirectory, entry.name, suffixAfterWildcard);
    if (isDirectory(entryPath) && isFile(path.join(entryPath, "package.json"))) {
      resolved.push(entryPath);
    }
  }
  return resolved;
};

export const listWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  if (patterns.length === 0) return [];

  const packages: WorkspacePackage[] = [];
  // HACK: workspace pattern lists routinely contain overlapping globs
  // (e.g. cal.com's `["packages/*", "packages/app-store"]`). Without
  // dedup-by-directory the same package would surface twice in
  // discovery and downstream every diagnostic for it would be emitted
  // twice. The seen-set is keyed on the absolute directory path so
  // symbolic naming via package.json#name can't accidentally collapse
  // two genuinely-distinct directories.
  const seenDirectories = new Set<string>();
  const pushIfNew = (workspacePackage: WorkspacePackage): void => {
    if (seenDirectories.has(workspacePackage.directory)) return;
    seenDirectories.add(workspacePackage.directory);
    packages.push(workspacePackage);
  };

  if (hasReactDependency(packageJson)) {
    const rootName = packageJson.name ?? path.basename(rootDirectory);
    pushIfNew({ name: rootName, directory: rootDirectory });
  }

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));

      if (!hasReactDependency(workspacePackageJson)) continue;

      const name = workspacePackageJson.name ?? path.basename(workspaceDirectory);
      pushIfNew({ name, directory: workspaceDirectory });
    }
  }

  return packages;
};

// True when the root manifest or any workspace package inside
// `rootDirectory` satisfies `predicate`. The boolean specialization of
// `findInWorkspacePackageJsons`, shared by the React Native and Reanimated
// project gates so both resolve workspaces identically.
export const someWorkspacePackageJson = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
  predicate: (packageJson: PackageJson) => boolean,
): boolean =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    predicate(packageJson) ? true : null,
  ) !== null;

// First non-null value produced by `select` over the root manifest and
// then each workspace package inside `rootDirectory`. One short-circuiting
// walk of the workspace globs (`getWorkspacePatterns` +
// `resolveWorkspaceDirectories`), shared by `someWorkspacePackageJson` (its
// boolean specialization) and the value-returning gates (e.g.
// `findExpoVersion`) so every workspace gate resolves packages identically.
export const findInWorkspacePackageJsons = <Value>(
  rootDirectory: string,
  rootPackageJson: PackageJson,
  select: (packageJson: PackageJson) => Value | null,
): Value | null => {
  const rootValue = select(rootPackageJson);
  if (rootValue !== null) return rootValue;

  const patterns = getWorkspacePatterns(rootDirectory, rootPackageJson);
  if (patterns.length === 0) return null;

  const visitedDirectories = new Set<string>();
  for (const pattern of patterns) {
    // Sort so the first non-null value is stable across runs — the raw order
    // comes from `readdir`, which isn't guaranteed consistent, and the
    // value-returning gates (e.g. `findExpoVersion`) must not return a
    // different workspace's spec on repeated analysis of the same tree.
    const directories = [...resolveWorkspaceDirectories(rootDirectory, pattern)].sort();
    for (const workspaceDirectory of directories) {
      if (visitedDirectories.has(workspaceDirectory)) continue;
      visitedDirectories.add(workspaceDirectory);
      const value = select(readPackageJson(path.join(workspaceDirectory, "package.json")));
      if (value !== null) return value;
    }
  }
  return null;
};

export const findDependencyInfoFromMonorepoRoot = (directory: string): DependencyInfo => {
  const monorepoRoot = findMonorepoRoot(directory);
  if (!monorepoRoot) return EMPTY_DEPENDENCY_INFO;

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return EMPTY_DEPENDENCY_INFO;

  const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
  const rootInfo = extractDependencyInfo(rootPackageJson);
  const leafPackageJsonPath = path.join(directory, "package.json");
  const leafPackageJson = isFile(leafPackageJsonPath) ? readPackageJson(leafPackageJsonPath) : null;
  const leafReactDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "react",
        sections: ["dependencies", "peerDependencies", "devDependencies"],
      })
    : null;
  const leafTailwindDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "tailwindcss",
        sections: ["dependencies", "devDependencies", "peerDependencies"],
      })
    : null;
  const leafZodDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "zod",
        sections: ["dependencies", "devDependencies", "peerDependencies"],
      })
    : null;
  const shouldUseReactFallback = !leafReactDeclaration?.hasDeclaration;
  const shouldUseTailwindFallback = leafTailwindDeclaration?.hasDeclaration ?? true;
  const shouldUseZodFallback = leafZodDeclaration?.hasDeclaration ?? true;
  const reactCatalogVersion = shouldUseReactFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "react",
        monorepoRoot,
        leafReactDeclaration?.catalogReference,
      )
    : null;
  const tailwindCatalogVersion = shouldUseTailwindFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "tailwindcss",
        monorepoRoot,
        leafTailwindDeclaration?.catalogReference,
      )
    : null;
  const zodCatalogVersion = shouldUseZodFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "zod",
        monorepoRoot,
        leafZodDeclaration?.catalogReference,
      )
    : null;
  const workspaceInfo = findReactInWorkspaces(monorepoRoot, rootPackageJson);

  return {
    reactVersion: shouldUseReactFallback
      ? (reactCatalogVersion ?? rootInfo.reactVersion ?? workspaceInfo.reactVersion)
      : (rootInfo.reactVersion ?? workspaceInfo.reactVersion),
    tailwindVersion: shouldUseTailwindFallback
      ? (tailwindCatalogVersion ?? rootInfo.tailwindVersion ?? workspaceInfo.tailwindVersion)
      : null,
    zodVersion: shouldUseZodFallback
      ? (zodCatalogVersion ?? rootInfo.zodVersion ?? workspaceInfo.zodVersion)
      : null,
    framework: rootInfo.framework !== "unknown" ? rootInfo.framework : workspaceInfo.framework,
  };
};

// True when the root manifest or any workspace package inside
// `rootDirectory` declares React Native. Walks workspaces with the
// same pattern resolver used elsewhere (`getWorkspacePatterns` +
// `resolveWorkspaceDirectories`) and short-circuits on the first
// match — most monorepos either have an obvious `apps/mobile` (hits
// almost immediately) or none at all (a single walk of the
// workspace globs, which we'd be doing anyway for React detection).
//
// Used so a web-rooted monorepo whose entry-point `package.json` is
// Next / Vite / Remix still loads `rn-*` rules when a sibling
// workspace targets React Native or Expo. The file-level package
// boundary in `oxlint-plugin-react-doctor` keeps those rules silent
// on the web workspaces — this just stops the rules from being
// dropped at the project level before the file-level gate gets a
// chance to run.
export const hasReactNativeWorkspaceAnywhere = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): boolean =>
  someWorkspacePackageJson(rootDirectory, rootPackageJson, isPackageJsonReactNativeAware);
