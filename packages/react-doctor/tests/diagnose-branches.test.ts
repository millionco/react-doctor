import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "../src/types.js";

interface LoadedConfigFixture {
  config: ReactDoctorConfig;
  sourceDirectory: string;
}

const state = vi.hoisted(() => ({
  loadedConfig: undefined as LoadedConfigFixture | null | undefined,
  resolvedDirectory: "/project",
  redirectedDirectory: null as string | null,
  projectInfo: undefined as ProjectInfo | undefined,
  lintDiagnostics: [] as Diagnostic[],
  deadCodeDiagnostics: [] as Diagnostic[],
  environmentDiagnostics: [] as Diagnostic[],
  mergedDiagnostics: [] as Diagnostic[],
  scoreResult: { score: 100, label: "Perfect" } as ScoreResult | null,
  lintError: undefined as Error | undefined,
  deadCodeError: undefined as Error | undefined,
  clearedCaches: [] as string[],
  consoleErrors: [] as string[],
}));

vi.mock("../src/utils/discover-project.js", () => ({
  clearProjectCache: () => state.clearedCaches.push("project"),
  discoverProject: () => state.projectInfo,
}));

vi.mock("../src/utils/load-config.js", () => ({
  clearConfigCache: () => state.clearedCaches.push("config"),
  loadConfigWithSource: () => state.loadedConfig,
}));

vi.mock("../src/utils/read-package-json.js", () => ({
  clearPackageJsonCache: () => state.clearedCaches.push("package-json"),
}));

vi.mock("../src/utils/collect-ignore-patterns.js", () => ({
  clearIgnorePatternsCache: () => state.clearedCaches.push("ignore-patterns"),
}));

vi.mock("../src/utils/resolve-config-root-dir.js", () => ({
  resolveConfigRootDir: () => state.redirectedDirectory,
}));

vi.mock("../src/utils/resolve-diagnose-target.js", () => ({
  resolveDiagnoseTarget: () => state.resolvedDirectory,
}));

vi.mock("../src/utils/run-oxlint.js", () => ({
  runOxlint: async () => {
    if (state.lintError) throw state.lintError;
    return state.lintDiagnostics;
  },
}));

vi.mock("../src/utils/run-knip.js", () => ({
  runKnip: async () => {
    if (state.deadCodeError) throw state.deadCodeError;
    return state.deadCodeDiagnostics;
  },
}));

vi.mock("../src/utils/check-reduced-motion.js", () => ({
  checkReducedMotion: () => state.environmentDiagnostics,
}));

vi.mock("../src/utils/merge-and-filter-diagnostics.js", () => ({
  mergeAndFilterDiagnostics: (diagnostics: Diagnostic[]) => {
    state.mergedDiagnostics = diagnostics;
    return diagnostics;
  },
}));

vi.mock("../src/utils/calculate-score.js", () => ({
  calculateScore: async () => state.scoreResult,
}));

vi.mock("../src/utils/resolve-lint-include-paths.js", () => ({
  resolveLintIncludePaths: () => ["src/app.tsx"],
}));

vi.mock("../src/utils/jsx-include-paths.js", () => ({
  computeJsxIncludePaths: (includePaths: string[]) =>
    includePaths.length > 0 ? includePaths : undefined,
}));

vi.mock("../src/utils/read-file-lines-node.js", () => ({
  createNodeReadFileLinesSync: () => () => [],
}));

const { clearCaches, diagnose, NoReactDependencyError, ProjectNotFoundError } =
  await import("../src/index.js");

const buildProjectInfo = (reactVersion = "^19.0.0"): ProjectInfo => ({
  rootDirectory: state.resolvedDirectory,
  projectName: "project",
  reactVersion,
  tailwindVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  sourceFileCount: 1,
});

const buildDiagnostic = (rule: string): Diagnostic => ({
  filePath: "/project/src/app.tsx",
  plugin: "react-doctor",
  rule,
  severity: "warning",
  message: rule,
  line: 1,
  column: 1,
  category: "Correctness",
});

describe("diagnose branch coverage", () => {
  beforeEach(() => {
    state.loadedConfig = undefined;
    state.resolvedDirectory = "/project";
    state.redirectedDirectory = null;
    state.projectInfo = buildProjectInfo();
    state.lintDiagnostics = [];
    state.deadCodeDiagnostics = [];
    state.environmentDiagnostics = [];
    state.mergedDiagnostics = [];
    state.scoreResult = { score: 100, label: "Perfect" };
    state.lintError = undefined;
    state.deadCodeError = undefined;
    state.clearedCaches = [];
    state.consoleErrors = [];
    vi.spyOn(console, "error").mockImplementation((...messages) => {
      state.consoleErrors.push(messages.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears all module-level caches", () => {
    clearCaches();
    expect(state.clearedCaches).toEqual(["project", "config", "package-json", "ignore-patterns"]);
  });

  it("uses config defaults, catches runner failures, and includes environment diagnostics", async () => {
    const environmentDiagnostic = buildDiagnostic("reduced-motion");
    state.loadedConfig = {
      config: {
        lint: true,
        deadCode: true,
        respectInlineDisables: false,
        customRulesOnly: true,
        adoptExistingLintConfig: false,
      },
      sourceDirectory: "/repo",
    };
    state.redirectedDirectory = "/repo/apps/web";
    state.resolvedDirectory = "/repo/apps/web";
    state.projectInfo = buildProjectInfo();
    state.environmentDiagnostics = [environmentDiagnostic];
    state.lintError = new Error("lint exploded");
    state.deadCodeError = new Error("knip exploded");

    const result = await diagnose("/repo");

    expect(result.diagnostics).toEqual([environmentDiagnostic]);
    expect(state.consoleErrors.join("\n")).toContain("Lint failed:");
    expect(state.consoleErrors.join("\n")).toContain("Dead code analysis failed:");
  });

  it("skips dead code and reduced-motion checks in diff mode", async () => {
    const lintDiagnostic = buildDiagnostic("lint-rule");
    state.lintDiagnostics = [lintDiagnostic];
    state.deadCodeDiagnostics = [buildDiagnostic("dead-code")];
    state.environmentDiagnostics = [buildDiagnostic("reduced-motion")];

    const result = await diagnose("/project", {
      includePaths: ["src/app.tsx"],
    });

    expect(result.diagnostics).toEqual([lintDiagnostic]);
  });

  it("throws when target project cannot be resolved", async () => {
    state.resolvedDirectory = null;

    await expect(diagnose("/missing")).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("throws when project has no React dependency", async () => {
    state.projectInfo = buildProjectInfo(null);

    await expect(diagnose("/project")).rejects.toBeInstanceOf(NoReactDependencyError);
  });
});
