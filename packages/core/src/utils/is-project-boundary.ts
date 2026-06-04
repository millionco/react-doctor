import * as fs from "node:fs";
import * as path from "node:path";
import { isMonorepoRoot } from "../project-info/find-monorepo-root.js";

/**
 * True when `directory` looks like a project root we shouldn't walk
 * past — either the working tree's git root (a `.git` entry sits
 * here) or an npm/pnpm/yarn/bun monorepo root.
 *
 * Used as the stop-condition for the ancestor walks performed by
 * `detectUserLintConfigPaths`, `loadConfigWithSource`, and
 * `detectReactCompiler`. All three previously inlined their own
 * byte-equivalent copy.
 */
export const isProjectBoundary = (directory: string): boolean =>
  fs.existsSync(path.join(directory, ".git")) || isMonorepoRoot(directory);
