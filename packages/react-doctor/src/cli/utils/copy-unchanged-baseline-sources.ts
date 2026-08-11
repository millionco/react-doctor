import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isPathInsideDirectory, mapWithConcurrency } from "@react-doctor/core";
import { BASELINE_SOURCE_COPY_CONCURRENCY } from "./constants.js";
import { toForwardSlashes } from "./path-format.js";

export interface CopyUnchangedBaselineSourcesInput {
  readonly directory: string;
  readonly sourceFiles: ReadonlyArray<string>;
  readonly baseMaterializedFiles: ReadonlyArray<string>;
  readonly headChangedFiles: ReadonlyArray<string>;
  readonly untrackedFiles: ReadonlyArray<string>;
  readonly tempDirectory: string;
  readonly deadlineEpochMs: number | null;
  readonly signal?: AbortSignal;
}

export const copyUnchangedBaselineSources = async (
  input: CopyUnchangedBaselineSourcesInput,
): Promise<boolean> => {
  const baseMaterializedFiles = new Set(input.baseMaterializedFiles.map(toForwardSlashes));
  const headChangedFiles = new Set(input.headChangedFiles.map(toForwardSlashes));
  const untrackedFiles = new Set(input.untrackedFiles.map(toForwardSlashes));
  const sourceDirectory = path.resolve(input.directory);
  const targetDirectory = path.resolve(input.tempDirectory);
  const unchangedSourceFiles = input.sourceFiles.filter((filePath) => {
    const normalizedPath = toForwardSlashes(filePath);
    return (
      !baseMaterializedFiles.has(normalizedPath) &&
      !headChangedFiles.has(normalizedPath) &&
      !untrackedFiles.has(normalizedPath)
    );
  });
  const copiedFiles = await mapWithConcurrency(
    unchangedSourceFiles,
    BASELINE_SOURCE_COPY_CONCURRENCY,
    async (filePath): Promise<boolean> => {
      input.signal?.throwIfAborted();
      if (input.deadlineEpochMs !== null && Date.now() >= input.deadlineEpochMs) return false;
      const sourcePath = path.resolve(sourceDirectory, filePath);
      const targetPath = path.resolve(targetDirectory, filePath);
      if (
        !isPathInsideDirectory(sourcePath, sourceDirectory) ||
        !isPathInsideDirectory(targetPath, targetDirectory)
      ) {
        return false;
      }
      try {
        const sourceStats = await fs.lstat(sourcePath);
        if (!sourceStats.isFile()) return false;
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
        return true;
      } catch {
        input.signal?.throwIfAborted();
        return false;
      }
    },
  );
  return copiedFiles.every(Boolean);
};
