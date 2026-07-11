import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { FALLBACK_IGNORED_DIRECTORY_NAMES, SOURCE_FILE_EXTENSIONS } from "./constants.ts";
import type { BenchmarkTargetMetadata } from "./types.ts";

const runGit = (directory: string, argumentsList: string[]): string | null => {
  const result = spawnSync("git", argumentsList, {
    cwd: directory,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : null;
};

const collectFallbackSourceFiles = (directory: string): string[] => {
  const sourceFiles: string[] = [];
  const pendingDirectories = [directory];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) continue;
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          pendingDirectories.push(entryPath);
        }
      } else if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        sourceFiles.push(entryPath);
      }
    }
  }
  return sourceFiles;
};

export const collectTargetMetadata = (
  directory: string,
  targetId: string,
): BenchmarkTargetMetadata => {
  const directoryStats = fs.statSync(directory);
  if (!directoryStats.isDirectory())
    throw new Error(`Benchmark target is not a directory: ${directory}`);
  const gitFilesOutput = runGit(directory, ["ls-files", "-co", "--exclude-standard", "-z"]);
  const sourceFiles =
    gitFilesOutput === null
      ? collectFallbackSourceFiles(directory)
      : gitFilesOutput
          .split("\0")
          .filter((relativePath) => SOURCE_FILE_EXTENSIONS.has(path.extname(relativePath)))
          .map((relativePath) => path.resolve(directory, relativePath))
          .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  sourceFiles.sort();
  const sourceByteCount = sourceFiles.reduce(
    (totalBytes, filePath) => totalBytes + fs.statSync(filePath).size,
    0,
  );
  const sourceFingerprintHash = createHash("sha256");
  for (const filePath of sourceFiles) {
    sourceFingerprintHash.update(path.relative(directory, filePath));
    sourceFingerprintHash.update("\0");
    sourceFingerprintHash.update(fs.readFileSync(filePath));
    sourceFingerprintHash.update("\0");
  }
  const gitSha = runGit(directory, ["rev-parse", "HEAD"])?.trim() || null;
  const gitStatus = runGit(directory, ["status", "--short", "--untracked-files=normal", "--", "."]);
  return {
    targetId,
    directory,
    label: path.basename(directory),
    gitSha,
    isGitDirty: gitStatus === null ? null : gitStatus.trim().length > 0,
    sourceFileCount: sourceFiles.length,
    sourceByteCount,
    sourceFingerprint: sourceFingerprintHash.digest("hex"),
  };
};
