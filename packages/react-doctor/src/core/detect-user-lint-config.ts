import fs from "node:fs";
import path from "node:path";
import { ADOPTABLE_LINT_CONFIG_FILENAMES } from "../constants.js";
import { isFile } from "./is-file.js";
import { isMonorepoRoot } from "./find-monorepo-root.js";

const findFirstLintConfigInDirectory = (directory: string): string | null => {
  for (const filename of ADOPTABLE_LINT_CONFIG_FILENAMES) {
    const candidatePath = path.join(directory, filename);
    if (isFile(candidatePath)) return candidatePath;
  }
  return null;
};

// HACK: stop the walk-up at a project boundary (`.git` or a monorepo
// manifest). Without a stop, scanning a sub-package would silently
// adopt a `.oxlintrc.json` from any random ancestor on disk
// (e.g. the user's home directory) — same boundary semantics as
// `loadConfig` for `react-doctor.config.json`.
const isProjectBoundary = (directory: string): boolean =>
  fs.existsSync(path.join(directory, ".git")) || isMonorepoRoot(directory);

export const detectUserLintConfigPaths = (rootDirectory: string): string[] => {
  const directLintConfig = findFirstLintConfigInDirectory(rootDirectory);
  if (directLintConfig) return [directLintConfig];

  if (isProjectBoundary(rootDirectory)) return [];

  let ancestorDirectory = path.dirname(rootDirectory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorLintConfig = findFirstLintConfigInDirectory(ancestorDirectory);
    if (ancestorLintConfig) return [ancestorLintConfig];
    if (isProjectBoundary(ancestorDirectory)) return [];
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return [];
};
