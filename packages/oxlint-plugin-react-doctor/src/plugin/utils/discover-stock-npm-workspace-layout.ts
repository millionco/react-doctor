import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import {
  readStockNpmWorkspaceLayout,
  type StockNpmWorkspaceLayout,
} from "./read-stock-npm-workspace-layout.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_.-]*";
const WORKSPACE_PATH = new RegExp(`^${SEGMENT}(?:/${SEGMENT})?$`, "u");
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const WORKSPACE_LIMIT = 128;

const readSmallManifest = (filename: string): object | null => {
  recordExistenceProbe(filename);
  const info = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!info?.isFile() || info.nlink !== 1 || info.size > 64 * 1024) return null;
  const bytes = readProviderMember(filename);
  if (!bytes) return null;
  const manifest: unknown = JSON.parse(bytes.toString("utf8"));
  return manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : null;
};

const isPhysicalDirectory = (directory: string): boolean => {
  recordExistenceProbe(directory);
  recordRealpathProbe(directory);
  return (
    fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true &&
    fs.realpathSync(directory) === directory
  );
};

const listWorkspacePaths = (root: string, patterns: readonly string[]): Set<string> | null => {
  const workspaces = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      if (!WORKSPACE_PATH.test(pattern) || pattern.split("/").includes("node_modules")) return null;
      workspaces.add(pattern);
      continue;
    }
    const location = pattern.slice(0, -2);
    if (!WORKSPACE_PATH.test(location) || location === "node_modules" || location.includes("/")) {
      return null;
    }
    const parent = path.join(root, location);
    if (!isPhysicalDirectory(parent)) return null;
    recordDirectoryProbe(parent);
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return null;
      const relative = location + "/" + entry.name;
      if (!entry.isDirectory() || !WORKSPACE_PATH.test(relative) || entry.name === "node_modules") {
        continue;
      }
      const candidate = path.join(root, relative, "package.json");
      recordExistenceProbe(candidate);
      if (fs.lstatSync(candidate, { throwIfNoEntry: false })) workspaces.add(relative);
      if (workspaces.size > WORKSPACE_LIMIT) return null;
    }
  }
  return workspaces.size > 0 && workspaces.size <= WORKSPACE_LIMIT ? workspaces : null;
};

// npm allows more layout forms. This proof selects a regular root workspace
// plus direct folders and one-segment wildcards with exact npm link targets.
export const discoverStockNpmWorkspaceLayout = (
  installationRoot: string,
  buildRoot: string,
): StockNpmWorkspaceLayout | null => {
  if (
    !path.isAbsolute(installationRoot) ||
    !path.isAbsolute(buildRoot) ||
    path.dirname(buildRoot) !== installationRoot
  )
    return null;
  try {
    if (!isPhysicalDirectory(installationRoot) || !isPhysicalDirectory(buildRoot)) return null;
    const root = readSmallManifest(path.join(installationRoot, "package.json"));
    const patterns = (root as { workspaces?: unknown } | null)?.workspaces;
    if (
      !Array.isArray(patterns) ||
      patterns.length > WORKSPACE_LIMIT ||
      !patterns.every((pattern): pattern is string => typeof pattern === "string")
    )
      return null;
    const workspaces = listWorkspacePaths(installationRoot, patterns);
    if (!workspaces?.has(path.relative(installationRoot, buildRoot))) return null;
    const workspaceLinks: Record<string, string> = Object.create(null);
    for (const workspace of workspaces) {
      const workspaceDirectory = path.join(installationRoot, workspace);
      if (!isPhysicalDirectory(workspaceDirectory)) return null;
      const manifest = readSmallManifest(path.join(workspaceDirectory, "package.json"));
      const name = (manifest as { name?: unknown } | null)?.name;
      if (typeof name !== "string" || !PACKAGE_NAME.test(name) || name === "node_modules") {
        return null;
      }
      const slot = "node_modules/" + name;
      if (Object.hasOwn(workspaceLinks, slot)) return null;
      workspaceLinks[slot] = workspace;
    }
    const moduleRoots = ["node_modules"];
    const buildModules = path.join(buildRoot, "node_modules");
    recordExistenceProbe(buildModules);
    if (fs.lstatSync(buildModules, { throwIfNoEntry: false })) {
      moduleRoots.push(path.relative(installationRoot, buildModules));
    }
    const layout = { moduleRoots, workspaceLinks };
    return readStockNpmWorkspaceLayout(installationRoot, layout) ? layout : null;
  } catch {
    return null;
  }
};
