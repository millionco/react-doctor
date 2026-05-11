import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, ProjectInfo, ScoreResult } from "../src/types.js";

const state = vi.hoisted(() => ({
  projectInfo: undefined as ProjectInfo | undefined,
  lintDiagnostics: [] as Diagnostic[],
  deadCodeDiagnostics: [] as Diagnostic[],
  scoreResult: { score: 92, label: "Great" } as ScoreResult | null,
  nodeResolution: { binaryPath: process.execPath, version: process.version, isCurrentNode: true },
  isNvmInstalled: false,
  shouldInstallNode: false,
  shouldInstallNodeSucceed: false,
  lintError: undefined as Error | undefined,
  deadCodeError: undefined as Error | undefined,
  consoleOutput: [] as string[],
}));

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

vi.mock("../src/utils/discover-project.js", () => ({
  discoverProject: () => state.projectInfo,
  formatFrameworkName: (framework: string) => framework,
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

vi.mock("../src/utils/resolve-compatible-node.js", () => ({
  resolveNodeForOxlint: () => state.nodeResolution,
  isNvmInstalled: () => state.isNvmInstalled,
  installNodeViaNvm: () => state.shouldInstallNodeSucceed,
}));

vi.mock("../src/utils/prompts.js", () => ({
  prompts: async () => ({ shouldInstallNode: state.shouldInstallNode }),
}));

vi.mock("../src/utils/calculate-score.js", () => ({
  calculateScore: async () => state.scoreResult,
  calculateScoreLocally: () => state.scoreResult,
}));

vi.mock("../src/utils/load-config.js", () => ({
  loadConfigWithSource: () => null,
}));

vi.mock("../src/utils/resolve-lint-include-paths.js", () => ({
  resolveLintIncludePaths: () => ["src/app.tsx"],
}));

const { scan } = await import("../src/scan.js");

const buildProjectInfo = (): ProjectInfo => ({
  rootDirectory: "/project",
  projectName: "project",
  reactVersion: "^19.0.0",
  tailwindVersion: "4.0.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: false,
  sourceFileCount: 1,
});

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/project/src/app.tsx",
  plugin: "react-doctor",
  rule: "no-test-rule",
  severity: "warning",
  message: "Test message",
  help: "Test help",
  line: 3,
  column: 1,
  category: "Correctness",
  ...overrides,
});

describe("scan branch coverage", () => {
  beforeEach(() => {
    state.projectInfo = buildProjectInfo();
    state.lintDiagnostics = [];
    state.deadCodeDiagnostics = [];
    state.scoreResult = { score: 92, label: "Great" };
    state.nodeResolution = {
      binaryPath: process.execPath,
      version: process.version,
      isCurrentNode: true,
    };
    state.isNvmInstalled = false;
    state.shouldInstallNode = false;
    state.shouldInstallNodeSucceed = false;
    state.lintError = undefined;
    state.deadCodeError = undefined;
    state.consoleOutput = [];
    vi.spyOn(console, "log").mockImplementation((...messages) => {
      state.consoleOutput.push(messages.join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((...messages) => {
      state.consoleOutput.push(messages.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...messages) => {
      state.consoleOutput.push(messages.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints verbose diagnostics with file-only sites and suppression hints", async () => {
    state.lintDiagnostics = [
      buildDiagnostic({ suppressionHint: "Use react-doctor-disable-next-line" }),
      buildDiagnostic({ filePath: "/project/src/unknown.tsx", line: 0, help: undefined }),
    ];

    const result = await scan("/project", {
      lint: true,
      deadCode: false,
      verbose: true,
      offline: true,
    });

    expect(result.diagnostics).toHaveLength(2);
    expect(state.consoleOutput.join("\n")).toContain("Use react-doctor-disable-next-line");
    expect(state.consoleOutput.join("\n")).toContain("/project/src/unknown.tsx");
  });

  it("prints default diagnostics, share link, and hidden summary for grouped issues", async () => {
    state.lintDiagnostics = [
      buildDiagnostic({ rule: "no-alpha", severity: "error", category: "Correctness" }),
      buildDiagnostic({ rule: "no-beta", category: "Performance" }),
      buildDiagnostic({
        rule: "no-gamma",
        category: "Performance",
        url: "https://example.test/rule",
      }),
      buildDiagnostic({ rule: "no-delta", category: "Accessibility", help: undefined, line: 0 }),
      buildDiagnostic({ rule: "no-epsilon", category: "Security" }),
      buildDiagnostic({ rule: "no-zeta", category: "Style" }),
      buildDiagnostic({ rule: "no-eta", category: "Design" }),
    ];

    const result = await scan("/project", {
      lint: true,
      deadCode: false,
      share: true,
    });

    const output = state.consoleOutput.join("\n");
    expect(result.diagnostics).toHaveLength(7);
    expect(output).toContain("Share your results");
    expect(output).toContain("Full diagnostics written to");
    expect(output).toContain("Run `npx react-doctor@latest . --verbose`");
  });

  it("prints incomplete no-issue summary when lint cannot run", async () => {
    state.nodeResolution = null;

    const result = await scan("/project", {
      lint: true,
      deadCode: false,
    });

    expect(result.skippedChecks).toEqual(["lint"]);
    expect(state.consoleOutput.join("\n")).toContain("results are incomplete");
  });

  it("marks both checks skipped when lint and dead code fail", async () => {
    state.lintError = new Error("native binding missing");
    state.deadCodeError = new Error("knip failed");

    const result = await scan("/project", {
      lint: true,
      deadCode: true,
    });

    expect(result.skippedChecks).toEqual(["lint", "dead code"]);
    expect(state.consoleOutput.join("\n")).toContain("Upgrade to Node");
    expect(state.consoleOutput.join("\n")).toContain("knip failed");
  });

  it("prints score-only value without project details", async () => {
    const result = await scan("/project", {
      lint: false,
      deadCode: false,
      scoreOnly: true,
    });

    expect(result.score?.score).toBe(92);
    expect(state.consoleOutput).toContain("92");
  });

  it("prints score-only offline message when score is unavailable", async () => {
    state.scoreResult = null;

    const result = await scan("/project", {
      lint: false,
      deadCode: false,
      scoreOnly: true,
    });

    expect(result.score).toBeNull();
    expect(state.consoleOutput.join("\n")).toContain("offline");
  });
});
