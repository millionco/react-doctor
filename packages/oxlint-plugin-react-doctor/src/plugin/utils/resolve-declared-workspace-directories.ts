import * as fs from "node:fs";
import * as path from "node:path";
import { isPathInside } from "./is-path-inside.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";

const readPnpmWorkspacePatterns = (workspaceRoot: string): string[] | null => {
  const workspaceFilePaths = ["pnpm-workspace.yaml", "pnpm-workspace.yml"].map((fileName) =>
    path.join(workspaceRoot, fileName),
  );
  const workspaceFilePath = workspaceFilePaths.find((filePath) => fs.existsSync(filePath));
  if (workspaceFilePath === undefined) return null;

  let content: string;
  try {
    content = fs.readFileSync(workspaceFilePath, "utf8");
  } catch {
    return null;
  }

  const patterns: string[] = [];
  let isInsidePackagesBlock = false;
  for (const line of content.split("\n")) {
    const trimmedLine = line.trim();
    if (trimmedLine === "packages:") {
      isInsidePackagesBlock = true;
      continue;
    }
    if (isInsidePackagesBlock && trimmedLine.startsWith("-")) {
      patterns.push(trimmedLine.replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
    } else if (isInsidePackagesBlock && trimmedLine.length > 0 && !trimmedLine.startsWith("#")) {
      break;
    }
  }
  return patterns;
};

const readPackageWorkspacePatterns = (manifest: PackageManifest): string[] | null => {
  if (Array.isArray(manifest.workspaces)) {
    return manifest.workspaces.filter(
      (workspacePattern): workspacePattern is string => typeof workspacePattern === "string",
    );
  }
  if (typeof manifest.workspaces !== "object" || manifest.workspaces === null) return null;
  const packages = Reflect.get(manifest.workspaces, "packages");
  if (!Array.isArray(packages)) return null;
  return packages.filter(
    (workspacePattern): workspacePattern is string => typeof workspacePattern === "string",
  );
};

const resolvePatternDirectories = (
  workspaceRoot: string,
  workspacePattern: string,
): string[] | null => {
  const normalizedPattern = workspacePattern.replace(/\/\*\*$/, "/*");
  if (
    normalizedPattern.startsWith("!") ||
    /[?[\]{}]/.test(normalizedPattern) ||
    (normalizedPattern.match(/\*/g)?.length ?? 0) > 1
  ) {
    return null;
  }

  if (!normalizedPattern.includes("*")) {
    const directory = path.resolve(workspaceRoot, normalizedPattern);
    if (!isPathInside(directory, workspaceRoot)) return null;
    return fs.existsSync(path.join(directory, "package.json")) ? [directory] : [];
  }

  const wildcardIndex = normalizedPattern.indexOf("*");
  const baseDirectory = path.resolve(workspaceRoot, normalizedPattern.slice(0, wildcardIndex));
  if (!isPathInside(baseDirectory, workspaceRoot)) return null;
  const suffixAfterWildcard = normalizedPattern.slice(wildcardIndex + 1);
  if (suffixAfterWildcard.length > 0 && !suffixAfterWildcard.startsWith("/")) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDirectory, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.resolve(baseDirectory, entry.name, `.${suffixAfterWildcard}`);
    if (!isPathInside(directory, workspaceRoot)) return null;
    if (fs.existsSync(path.join(directory, "package.json"))) directories.push(directory);
  }
  return directories;
};

// `null` means the declaration cannot be resolved without a full glob engine;
// callers preserve compatibility by falling back to recursive discovery.
export const resolveDeclaredWorkspaceDirectories = (
  workspaceRoot: string,
  rootManifest: PackageManifest,
): string[] | null => {
  const patterns =
    readPnpmWorkspacePatterns(workspaceRoot) ?? readPackageWorkspacePatterns(rootManifest);
  if (patterns === null || patterns.length === 0) return null;

  const directories = new Set<string>();
  for (const workspacePattern of patterns) {
    const resolvedDirectories = resolvePatternDirectories(workspaceRoot, workspacePattern);
    if (resolvedDirectories === null) return null;
    for (const directory of resolvedDirectories) directories.add(directory);
  }
  return [...directories];
};
