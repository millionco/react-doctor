import { execSync } from "node:child_process";
import path from "node:path";
import { MOTION_LIBRARY_PACKAGES } from "../plugin/constants.js";
import type { Diagnostic } from "../types.js";
import { isFile } from "./is-file.js";
import { readPackageJson } from "./read-package-json.js";

const REDUCED_MOTION_GREP_PATTERN = "prefers-reduced-motion|useReducedMotion";
const REDUCED_MOTION_FILE_GLOBS = '"*.ts" "*.tsx" "*.js" "*.jsx" "*.css" "*.scss"';

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
  weight: 2,
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

  try {
    execSync(`git grep -ql -E "${REDUCED_MOTION_GREP_PATTERN}" -- ${REDUCED_MOTION_FILE_GLOBS}`, {
      cwd: rootDirectory,
      stdio: "pipe",
    });
    return [];
  } catch {
    return [MISSING_REDUCED_MOTION_DIAGNOSTIC];
  }
};
