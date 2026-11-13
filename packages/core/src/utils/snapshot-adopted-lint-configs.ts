import * as fs from "node:fs";
import * as path from "node:path";
import { parseJSONC } from "confbox";
import {
  ADOPTED_LINT_CONFIG_MAX_BYTES,
  ADOPTED_LINT_CONFIG_MAX_DEPTH,
  ADOPTED_LINT_CONFIG_MAX_FILES,
} from "../constants.js";
import { isPlainObject } from "../project-info/index.js";
import { findGitRepositoryRoot } from "./find-git-repository-root.js";
import { isPathInsideDirectory } from "./is-path-inside-directory.js";
import { isSymlinkFreePath } from "./is-symlink-free-path.js";
import { readTextFileUpToCharacterLimitSync } from "./read-text-file-up-to-character-limit-sync.js";

interface SnapshotAdoptedLintConfigsInput {
  readonly configPaths: ReadonlyArray<string>;
  readonly rootDirectory: string;
  readonly snapshotDirectory: string;
}

export const snapshotAdoptedLintConfigs = (input: SnapshotAdoptedLintConfigsInput): string[] => {
  const sourceBoundaryDirectory = path.resolve(
    findGitRepositoryRoot(input.rootDirectory) ?? input.rootDirectory,
  );
  const boundaryDirectory = fs.realpathSync(sourceBoundaryDirectory);
  const snapshots = new Map<string, string>();
  const expandedFileCounts = new Map<string, number>();
  const activePaths = new Set<string>();
  let expandedFileCount = 0;

  const snapshotConfig = (configPath: string, depth: number): string => {
    const resolvedPath = path.resolve(configPath);
    const existingSnapshot = snapshots.get(resolvedPath);
    if (existingSnapshot) {
      expandedFileCount += expandedFileCounts.get(resolvedPath) ?? 1;
      if (expandedFileCount > ADOPTED_LINT_CONFIG_MAX_FILES) {
        throw new Error("Adopted lint config expands too many files");
      }
      return existingSnapshot;
    }
    if (
      depth > ADOPTED_LINT_CONFIG_MAX_DEPTH ||
      expandedFileCount >= ADOPTED_LINT_CONFIG_MAX_FILES ||
      activePaths.has(resolvedPath) ||
      !isSymlinkFreePath(resolvedPath, boundaryDirectory)
    ) {
      throw new Error("Unsafe adopted lint config chain");
    }
    const configStats = fs.lstatSync(resolvedPath);
    if (!configStats.isFile() || configStats.size > ADOPTED_LINT_CONFIG_MAX_BYTES) {
      throw new Error("Unsupported adopted lint config file");
    }
    const previousFileCount = expandedFileCount;
    expandedFileCount += 1;
    activePaths.add(resolvedPath);
    try {
      const source = readTextFileUpToCharacterLimitSync({
        filePath: resolvedPath,
        maximumLengthChars: ADOPTED_LINT_CONFIG_MAX_BYTES,
        sizeBytes: configStats.size,
      });
      const parsed = parseJSONC<unknown>(source, { allowTrailingComma: true });
      if (!isPlainObject(parsed)) throw new Error("Invalid adopted lint config");
      const sanitized = snapshotValue(parsed, resolvedPath, depth);
      const snapshotPath = path.join(input.snapshotDirectory, `adopted-${snapshots.size}.json`);
      fs.writeFileSync(snapshotPath, JSON.stringify(sanitized), { flag: "wx", mode: 0o600 });
      snapshots.set(resolvedPath, snapshotPath);
      expandedFileCounts.set(resolvedPath, expandedFileCount - previousFileCount);
      return snapshotPath;
    } finally {
      activePaths.delete(resolvedPath);
    }
  };

  const snapshotValue = (value: unknown, configPath: string, depth: number): unknown => {
    if (depth > ADOPTED_LINT_CONFIG_MAX_DEPTH) throw new Error("Adopted lint config too deep");
    if (Array.isArray(value)) {
      return value.map((entry) => snapshotValue(entry, configPath, depth + 1));
    }
    if (!isPlainObject(value)) return value;
    if (Object.hasOwn(value, "jsPlugins")) throw new Error("Executable adopted lint config");
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (key !== "extends") return [key, snapshotValue(entry, configPath, depth + 1)];
        const entries = Array.isArray(entry) ? entry : [entry];
        return [
          key,
          entries.map((extendedPath) => {
            if (typeof extendedPath !== "string") throw new Error("Invalid lint config extends");
            return snapshotConfig(path.resolve(path.dirname(configPath), extendedPath), depth + 1);
          }),
        ];
      }),
    );
  };

  return input.configPaths.flatMap((configPath) => {
    try {
      if (!isPathInsideDirectory(configPath, sourceBoundaryDirectory)) return [];
      const canonicalConfigPath = path.join(
        boundaryDirectory,
        path.relative(sourceBoundaryDirectory, configPath),
      );
      return [snapshotConfig(canonicalConfigPath, 0)];
    } catch {
      return [];
    }
  });
};
