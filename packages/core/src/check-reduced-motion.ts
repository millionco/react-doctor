import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { MOTION_LIBRARY_PACKAGES } from "oxlint-plugin-react-doctor";
import type { Diagnostic } from "./types/index.js";
import { IGNORED_DIRECTORIES } from "./constants.js";
import { hasIgnoredPathSegment } from "./utils/has-ignored-path-segment.js";
import { isFile, readDirectoryEntries, readPackageJson } from "./project-info/index.js";

const REDUCED_MOTION_PATTERN = /prefers-reduced-motion|useReducedMotion|MotionConfig|reducedMotion/;
const REDUCED_MOTION_GREP_PATTERN =
  "prefers-reduced-motion|useReducedMotion|MotionConfig|reducedMotion";
const REDUCED_MOTION_FILE_GLOBS = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.css", "*.scss"];
const REDUCED_MOTION_FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss"]);

const GIT_GREP_NO_MATCH_STATUS = 1;

const MISSING_REDUCED_MOTION_DIAGNOSTIC: Diagnostic = {
  filePath: "package.json",
  plugin: "react-doctor",
  rule: "require-reduced-motion",
  severity: "error",
  message:
    "Project uses a motion library but has no prefers-reduced-motion handling — required for accessibility (WCAG 2.3.3)",
  help: "Add `useReducedMotion()` from your animation library, or a `@media (prefers-reduced-motion: reduce)` CSS query",
  line: 0,
  column: 0,
  category: "Accessibility",
};

// Fallback for trees where `git grep` can't run (no git binary, not a
// repository). Mirrors the git path's file globs and must reach the same
// verdict so scans of one tree don't diverge on git availability.
const hasReducedMotionHandlingViaFilesystem = (rootDirectory: string): boolean => {
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (currentDirectory === undefined) continue;
    for (const entry of readDirectoryEntries(currentDirectory)) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        stack.push(path.join(currentDirectory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!REDUCED_MOTION_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
      let content: string;
      try {
        content = fs.readFileSync(path.join(currentDirectory, entry.name), "utf-8");
      } catch {
        continue;
      }
      if (REDUCED_MOTION_PATTERN.test(content)) return true;
    }
  }
  return false;
};

export const checkReducedMotion = (rootDirectory: string): Diagnostic[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return [];

  let hasMotionLibrary = false;
  try {
    const packageJson = readPackageJson(packageJsonPath);
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    hasMotionLibrary = Object.keys(allDependencies).some((packageName) =>
      MOTION_LIBRARY_PACKAGES.has(packageName),
    );
  } catch {
    return [];
  }
  if (!hasMotionLibrary) return [];

  const result = spawnSync(
    "git",
    ["grep", "--untracked", "-lE", REDUCED_MOTION_GREP_PATTERN, "--", ...REDUCED_MOTION_FILE_GLOBS],
    { cwd: rootDirectory, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const gitRan =
    !result.error && (result.status === 0 || result.status === GIT_GREP_NO_MATCH_STATUS);
  if (!gitRan) {
    return hasReducedMotionHandlingViaFilesystem(rootDirectory)
      ? []
      : [MISSING_REDUCED_MOTION_DIAGNOSTIC];
  }
  // Ignore matches inside ignored build directories so the verdict matches the
  // filesystem fallback (which never descends into them) — a committed bundle
  // that mentions `prefers-reduced-motion` doesn't prove the app source handles
  // it, so `git grep` and the walk agree on one tree.
  const hasHandlingInSource =
    result.status === 0 &&
    result.stdout
      .split("\n")
      .some((filePath) => filePath.length > 0 && !hasIgnoredPathSegment(filePath));
  return hasHandlingInSource ? [] : [MISSING_REDUCED_MOTION_DIAGNOSTIC];
};
