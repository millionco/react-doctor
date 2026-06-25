import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isPathInside, STAGED_FILES_PROJECT_CONFIG_FILENAMES } from "@react-doctor/core";
import { STATS_TEMP_DIR_PREFIX } from "./constants.js";
import type { ReconstructedFile } from "./types.js";

export interface MaterializedReconstruction {
  readonly tempDirectory: string;
  /** `realpath` of `tempDirectory` (macOS symlinks `/var` → `/private/var`). */
  readonly realTempDirectory: string;
  readonly relativePaths: string[];
  readonly cleanup: () => void;
}

/**
 * Write reconstructed file content into a fresh temp tree mirroring the scan
 * layout, copying the project-config files (`tsconfig` / `package.json` /
 * `doctor.config` / oxlintrc) from `scanRoot` so oxlint resolves the same
 * config it would in the real project. In-memory sibling of core's
 * `materializeSourceTree` (which reads from git); the zip-slip guard mirrors it.
 */
export const materializeReconstructedTree = (
  scanRoot: string,
  files: ReadonlyArray<ReconstructedFile>,
): MaterializedReconstruction => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), STATS_TEMP_DIR_PREFIX));
  const resolvedTempDirectory = path.resolve(tempDirectory);
  const relativePaths: string[] = [];

  for (const file of files) {
    const targetPath = path.resolve(resolvedTempDirectory, file.relativePath);
    if (!isPathInside(targetPath, resolvedTempDirectory)) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content);
    relativePaths.push(file.relativePath);
  }

  for (const configFilename of STAGED_FILES_PROJECT_CONFIG_FILENAMES) {
    const sourcePath = path.join(scanRoot, configFilename);
    const targetPath = path.join(resolvedTempDirectory, configFilename);
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    }
  }

  let realTempDirectory = resolvedTempDirectory;
  try {
    realTempDirectory = fs.realpathSync(resolvedTempDirectory);
  } catch {
    // realpath unavailable (broken symlink, permission); keep the resolved path.
  }

  return {
    tempDirectory: resolvedTempDirectory,
    realTempDirectory,
    relativePaths,
    cleanup: () => {
      try {
        fs.rmSync(resolvedTempDirectory, { recursive: true, force: true });
      } catch {
        // Best-effort; the OS tempdir reaper eventually runs.
      }
    },
  };
};
