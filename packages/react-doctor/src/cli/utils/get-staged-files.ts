import * as Effect from "effect/Effect";
import fs from "node:fs";
import path from "node:path";
import { GIT_SHOW_MAX_BUFFER_BYTES, Git, SOURCE_FILE_PATTERN } from "@react-doctor/core";

// HACK: --diff-filter=ACMR excludes Deleted (D) — staged-only scans cannot
// lint files that no longer exist in the staging area.
const getStagedFilePaths = (directory: string): string[] => {
  try {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.stagedFilePaths(directory);
      }).pipe(Effect.provide(Git.layerNode)),
    );
    return [...result];
  } catch {
    return [];
  }
};

const readStagedContent = (directory: string, relativePath: string): string | null => {
  try {
    return Effect.runSync(
      Effect.gen(function* () {
        const git = yield* Git;
        return yield* git.showStagedContent(directory, relativePath, {
          maxBufferBytes: GIT_SHOW_MAX_BUFFER_BYTES,
        });
      }).pipe(Effect.provide(Git.layerNode)),
    );
  } catch {
    return null;
  }
};

interface StagedSnapshot {
  tempDirectory: string;
  stagedFiles: string[];
  cleanup: () => void;
}

export const getStagedSourceFiles = (directory: string): string[] =>
  getStagedFilePaths(directory).filter((filePath) => SOURCE_FILE_PATTERN.test(filePath));

const PROJECT_CONFIG_FILENAMES = [
  "tsconfig.json",
  "tsconfig.base.json",
  "package.json",
  "react-doctor.config.json",
  "oxlint.json",
  ".oxlintrc.json",
];

export const materializeStagedFiles = (
  directory: string,
  stagedFiles: string[],
  tempDirectory: string,
): StagedSnapshot => {
  const materializedFiles: string[] = [];

  for (const relativePath of stagedFiles) {
    const content = readStagedContent(directory, relativePath);
    if (content === null) continue;

    const targetPath = path.join(tempDirectory, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
    materializedFiles.push(relativePath);
  }

  for (const configFilename of PROJECT_CONFIG_FILENAMES) {
    const sourcePath = path.join(directory, configFilename);
    const targetPath = path.join(tempDirectory, configFilename);
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.cpSync(sourcePath, targetPath);
    }
  }

  return {
    tempDirectory,
    stagedFiles: materializedFiles,
    cleanup: () => {
      try {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; tempdir reapers will eventually clean up.
      }
    },
  };
};
