import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../../src/types.js";

export const writeFile = (filePath: string, contents: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

export const writeJson = (filePath: string, contents: unknown): void => {
  writeFile(filePath, JSON.stringify(contents, null, 2));
};

// HACK: defaults to NOT staging or committing — most callers want to
// drive the index themselves. Pass `{ commit: true }` to do an
// `add . && commit -m init` of whatever's already in the working tree
// (used by checkReducedMotion-style tests that need committed source
// for `git grep` to find).
export const initGitRepo = (directory: string, options: { commit?: boolean } = {}): void => {
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: directory });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: directory });
  spawnSync("git", ["config", "user.name", "test"], { cwd: directory });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: directory });
  if (options.commit === true) {
    spawnSync("git", ["add", "."], { cwd: directory });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: directory });
  }
};

export const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "test-rule",
  severity: "warning",
  message: "x",
  help: "",
  line: 1,
  column: 1,
  category: "Test",
  ...overrides,
});

export interface SetupReactProjectOptions {
  /** Files to create, keyed by path relative to the project root. */
  files?: Record<string, string>;
  /** Extra fields to merge into the generated `package.json`. */
  packageJsonExtras?: Record<string, unknown>;
  /** Override the React version (default: `^19.0.0`). */
  reactVersion?: string;
  /** Skip writing `tsconfig.json` (default: written with JSX preserve). */
  skipTsConfig?: boolean;
}

// Creates a minimal React project at `path.join(parentTempDir, caseId)`,
// returns the project's absolute path. Always writes `package.json` and
// (unless skipped) `tsconfig.json`. Use `files` to drop in source code
// or extra config files. Replaces the previous three near-duplicate
// helpers across the regression suite.
export const setupReactProject = (
  parentTempDir: string,
  caseId: string,
  options: SetupReactProjectOptions = {},
): string => {
  const projectDir = path.join(parentTempDir, caseId);
  fs.mkdirSync(projectDir, { recursive: true });
  writeJson(path.join(projectDir, "package.json"), {
    name: caseId,
    dependencies: {
      react: options.reactVersion ?? "^19.0.0",
      "react-dom": options.reactVersion ?? "^19.0.0",
    },
    ...options.packageJsonExtras,
  });
  if (options.skipTsConfig !== true) {
    writeJson(path.join(projectDir, "tsconfig.json"), {
      compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
    });
  }
  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    writeFile(path.join(projectDir, relativePath), content);
  }
  return projectDir;
};
