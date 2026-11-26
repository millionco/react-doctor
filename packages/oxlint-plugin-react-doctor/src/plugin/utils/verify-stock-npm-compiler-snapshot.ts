import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { recordDirectoryProbe } from "./cross-file-probe-recorder.js";
import {
  readStockNpmWorkspaceLayout,
  type StockNpmWorkspaceLayout,
} from "./read-stock-npm-workspace-layout.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

export interface StockNpmCompilerSnapshot {
  readonly packages: number;
  readonly members: number;
  readonly contentDigest: string;
  readonly layout?: StockNpmWorkspaceLayout;
  readonly canonicalModuleRootSlots?: boolean;
}

type FilesystemEntry = readonly [filename: string, directory: boolean];
type PackageMember = readonly [relativePath: string, size: number, digest: string];
type PackageContents = readonly [relativeDirectory: string, memberCount: number, digest: string];

const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const isPhysicalDirectory = (directory: string): boolean =>
  fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() === true &&
  fs.realpathSync(directory) === directory;

const readEntries = (
  directory: string,
  workspaceLinks?: ReadonlySet<string>,
): FilesystemEntry[] | null => {
  recordDirectoryProbe(directory);
  const entries: FilesystemEntry[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (workspaceLinks?.has(file)) {
      if (!entry.isSymbolicLink()) return null;
      continue;
    }
    if (!entry.isDirectory() && !entry.isFile()) return null;
    entries.push([file, entry.isDirectory()]);
  }
  return entries;
};

const listPackageDirectories = (
  nodeModules: string,
  workspaceLinks?: ReadonlySet<string>,
): string[] | null => {
  const entries = readEntries(nodeModules, workspaceLinks);
  if (!entries) return null;
  const packages: string[] = [];
  for (const [filename, directory] of entries) {
    const name = path.basename(filename);
    if (name === ".bin" || name === ".cache") {
      if (!directory) return null;
    } else if (name === ".package-lock.json" || name === ".yarn-integrity") {
      if (directory) return null;
    } else if (!directory || name.startsWith(".")) {
      return null;
    } else if (name.startsWith("@")) {
      const scoped = readEntries(filename, workspaceLinks);
      if (!scoped?.every((entry) => entry[1])) return null;
      packages.push(...scoped.map((entry) => entry[0]));
    } else {
      packages.push(filename);
    }
  }
  return packages;
};

const readPackageContents = (
  packageDirectory: string,
  maxMembers: number,
): PackageMember[] | null => {
  const pending = [packageDirectory];
  const members: PackageMember[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = readEntries(directory);
    if (!entries) return null;
    for (const [filename, isDirectory] of entries) {
      if (isDirectory) {
        if (directory !== packageDirectory || path.basename(filename) !== "node_modules") {
          pending.push(filename);
        }
        continue;
      }
      if (members.length >= maxMembers) return null;
      const bytes = readProviderMember(filename);
      if (!bytes) return null;
      members.push([path.relative(packageDirectory, filename), bytes.length, digest(bytes)]);
    }
  }
  members.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return members;
};

// Verify a fixed npm installation without evaluating packages or trusting a
// hidden lockfile as a complete inventory. Extra resolution candidates are
// outside this exact profile even when their own manifest looks stock.
export const verifyStockNpmCompilerSnapshot = (
  root: string,
  expected: StockNpmCompilerSnapshot,
): boolean => {
  const moduleRoot = path.join(root, "node_modules");
  if (!isPhysicalDirectory(moduleRoot) || path.sep !== "/") return false;
  const layout = expected.layout && readStockNpmWorkspaceLayout(root, expected.layout);
  if (expected.layout && !layout) return false;
  if (
    expected.canonicalModuleRootSlots &&
    (!layout || layout.moduleDirectories[0] !== moduleRoot)
  ) {
    return false;
  }
  const pending = (layout?.moduleDirectories ?? [moduleRoot]).map((directory, slot) => ({
    directory,
    slot,
    moduleDirectory: directory,
  }));
  const packages: PackageContents[] = [];
  let memberCount = 0;
  while (pending.length > 0) {
    const { directory, slot, moduleDirectory } = pending.pop()!;
    const directories = listPackageDirectories(
      directory,
      directory === moduleRoot && layout ? layout.links : undefined,
    );
    if (!directories) return false;
    for (const directory of directories) {
      if (packages.length >= expected.packages) return false;
      const members = readPackageContents(directory, expected.members - memberCount);
      if (!members?.length) return false;
      memberCount += members.length;
      packages.push([
        expected.canonicalModuleRootSlots
          ? path.join(String(slot), path.relative(moduleDirectory, directory))
          : path.relative(root, directory),
        members.length,
        digest(JSON.stringify(members)),
      ]);
      const nested = path.join(directory, "node_modules");
      const info = fs.lstatSync(nested, { throwIfNoEntry: false });
      if (info) {
        if (!info.isDirectory()) return false;
        pending.push({ directory: nested, slot, moduleDirectory });
      }
    }
  }
  if (packages.length !== expected.packages || memberCount !== expected.members) return false;
  packages.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return (
    (digest(JSON.stringify(packages)) === expected.contentDigest &&
      (!expected.layout || readStockNpmWorkspaceLayout(root, expected.layout) !== null)) === true
  );
};
