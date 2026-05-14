import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runOxlint } from "../../src/core/runners/run-oxlint.js";
import type { Diagnostic } from "../../src/types/diagnostic.js";
import type { ProjectInfo } from "../../src/types/project-info.js";

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

export interface CollectRuleHitsOptions {
  /** React major to forward to runOxlint (default: 19). Pass null to test the unresolvable-version path. */
  reactMajorVersion?: number | null;
  /**
   * Tailwind dependency spec to forward to runOxlint (default: omitted →
   * `null`, which optimistically assumes latest Tailwind so every
   * Tailwind-version-gated rule fires). Pass an explicit string
   * (`"^3.4.0"`, `"3.3.0"`, `"^4.0.0"`) to exercise version gating
   * for rules like `design-no-redundant-size-axes`.
   */
  tailwindVersion?: string | null;
  /** Project framework hint (default: "unknown"). Set to "react-native" for RN-only rules. */
  framework?: "unknown" | "react-native";
  hasReactCompiler?: boolean;
  hasTanStackQuery?: boolean;
}

export interface BuildTestProjectOptions {
  rootDirectory: string;
  framework?: ProjectInfo["framework"];
  hasReactCompiler?: boolean;
  hasTanStackQuery?: boolean;
  reactMajorVersion?: number | null;
  hasTypeScript?: boolean;
  tailwindVersion?: string | null;
}

export const buildTestProject = (options: BuildTestProjectOptions): ProjectInfo => {
  const reactMajorVersion = options.reactMajorVersion ?? 19;
  return {
    rootDirectory: options.rootDirectory,
    projectName: path.basename(options.rootDirectory),
    reactVersion: reactMajorVersion !== null ? `^${reactMajorVersion}.0.0` : null,
    reactMajorVersion,
    tailwindVersion: options.tailwindVersion ?? null,
    framework: options.framework ?? "unknown",
    hasTypeScript: options.hasTypeScript ?? true,
    hasReactCompiler: options.hasReactCompiler ?? false,
    hasTanStackQuery: options.hasTanStackQuery ?? false,
    sourceFileCount: 0,
  };
};

export interface RuleHit {
  filePath: string;
  message: string;
}

// Replaces the five near-identical `collectRuleHits` helpers that each
// regression suite previously declared at the top of the file. Defaults
// match the most common shape (React 19, framework="unknown"); pass an
// options bag to override per-test.
//
// HACK: distinguish "caller didn't pass `reactMajorVersion`" (omit → 19,
// the synthetic project's actual React version) from "caller explicitly
// passed `null`" (testing the unresolvable-version code path). A naive
// `options.reactMajorVersion ?? 19` collapses both into 19 and silently
// changes what null-version tests are testing.
export const collectRuleHits = async (
  projectDir: string,
  ruleId: string,
  options: CollectRuleHitsOptions = {},
): Promise<RuleHit[]> => {
  const reactMajorVersion = Object.hasOwn(options, "reactMajorVersion")
    ? (options.reactMajorVersion ?? null)
    : 19;
  const project: ProjectInfo = {
    rootDirectory: projectDir,
    projectName: path.basename(projectDir),
    reactVersion: reactMajorVersion !== null ? `^${reactMajorVersion}.0.0` : null,
    reactMajorVersion,
    tailwindVersion: options.tailwindVersion ?? null,
    framework: options.framework ?? "unknown",
    hasTypeScript: true,
    hasReactCompiler: options.hasReactCompiler ?? false,
    hasTanStackQuery: options.hasTanStackQuery ?? false,
    sourceFileCount: 0,
  };
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project,
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === ruleId)
    .map((diagnostic) => ({
      filePath: diagnostic.filePath,
      message: diagnostic.message,
    }));
};
