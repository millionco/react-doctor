import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";

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

/** Stages everything and commits it, returning the new HEAD commit SHA. */
export const commitAll = (directory: string, message: string): string => {
  spawnSync("git", ["add", "."], { cwd: directory });
  spawnSync("git", ["commit", "-q", "-m", message], { cwd: directory });
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf-8" })
    .stdout.toString()
    .trim();
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
  /**
   * Project framework hint (default: "unknown"). Set to "react-native"
   * or "expo" to activate the `rn-*` rule bucket (both add the
   * `react-native` capability in `buildCapabilities`).
   */
  framework?: "unknown" | "react-native" | "expo";
  hasReactCompiler?: boolean;
  hasTanStackQuery?: boolean;
}

export interface BuildTestProjectOptions {
  rootDirectory: string;
  framework?: ProjectInfo["framework"];
  hasReactCompiler?: boolean;
  hasTanStackQuery?: boolean;
  hasReanimated?: boolean;
  reactMajorVersion?: number | null;
  hasTypeScript?: boolean;
  tailwindVersion?: string | null;
  nextjsVersion?: string | null;
  nextjsMajorVersion?: number | null;
  shopifyFlashListVersion?: string | null;
  shopifyFlashListMajorVersion?: number | null;
}

export const buildTestProject = (options: BuildTestProjectOptions): ProjectInfo => {
  // HACK: distinguish "caller didn't pass `reactMajorVersion`" (omit
  // → default 19) from "caller explicitly passed `null`" (testing the
  // unresolvable-version code path). A naive
  // `options.reactMajorVersion ?? 19` collapses both into 19 and
  // silently changes what null-version tests are testing.
  const reactMajorVersion = Object.hasOwn(options, "reactMajorVersion")
    ? (options.reactMajorVersion ?? null)
    : 19;
  const framework = options.framework ?? "unknown";
  const nextjsVersion = Object.hasOwn(options, "nextjsVersion")
    ? (options.nextjsVersion ?? null)
    : framework === "nextjs"
      ? "^15.0.0"
      : null;
  const nextjsMajorVersion = Object.hasOwn(options, "nextjsMajorVersion")
    ? (options.nextjsMajorVersion ?? null)
    : framework === "nextjs"
      ? 15
      : null;
  return {
    rootDirectory: options.rootDirectory,
    projectName: path.basename(options.rootDirectory),
    reactVersion: reactMajorVersion !== null ? `^${reactMajorVersion}.0.0` : null,
    reactMajorVersion,
    tailwindVersion: options.tailwindVersion ?? null,
    zodVersion: null,
    zodMajorVersion: null,
    framework,
    hasTypeScript: options.hasTypeScript ?? true,
    hasReactCompiler: options.hasReactCompiler ?? false,
    hasTanStackQuery: options.hasTanStackQuery ?? false,
    nextjsVersion,
    nextjsMajorVersion,
    hasReactNativeWorkspace: framework === "expo" || framework === "react-native",
    expoVersion: framework === "expo" ? "~51.0.0" : null,
    shopifyFlashListVersion: options.shopifyFlashListVersion ?? null,
    shopifyFlashListMajorVersion: options.shopifyFlashListMajorVersion ?? null,
    hasReanimated: options.hasReanimated ?? false,
    preactVersion: null,
    preactMajorVersion: null,
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
// options bag to override per-test. `reactMajorVersion: null` selects
// the unresolvable-version code path (see `buildTestProject` for the
// omitted-vs-null distinction).
export const collectRuleHits = async (
  projectDir: string,
  ruleId: string,
  options: CollectRuleHitsOptions = {},
): Promise<RuleHit[]> => {
  const project = buildTestProject({ rootDirectory: projectDir, ...options });
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project,
    // Force-enable the rule under test so default-disabled rules
    // (`defaultEnabled: false`) still produce hits here. Severity is
    // irrelevant — callers assert on file path and message, not severity.
    userConfig: { rules: { [`react-doctor/${ruleId}`]: "warn" } },
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === ruleId)
    .map((diagnostic) => ({
      filePath: diagnostic.filePath,
      message: diagnostic.message,
    }));
};
