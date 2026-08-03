import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult, JsonReport, ReactDoctorConfig } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import type { InspectFlags } from "../src/cli/utils/inspect-flags.js";
import { buildDiagnostic, buildTestProject } from "./regressions/_helpers.js";

interface InspectInvocation {
  readonly directory: string;
  readonly deadCode: boolean | undefined;
  readonly excludedProjectDirectories: ReadonlyArray<string>;
  readonly retainExcludedProjectDeadCodeDiagnostics: boolean;
}

const mockState = vi.hoisted(() => ({
  projectDirectories: [] as string[],
  inspectInvocations: [] as InspectInvocation[],
  resolvedDirectories: new Map<string, string>(),
  result: undefined as InspectResult | undefined,
  userConfig: undefined as ReactDoctorConfig | null | undefined,
  jsonReports: new Array<JsonReport>(),
  shouldExpireDeadline: false,
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

vi.mock("@react-doctor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-doctor/core")>();
  return {
    ...actual,
    resolveScanTarget: vi.fn(async (requestedDirectory: string) => ({
      resolvedDirectory:
        mockState.resolvedDirectories.get(requestedDirectory) ?? requestedDirectory,
      requestedDirectory,
      userConfig: mockState.userConfig ?? null,
      configSourceDirectory: null,
      didRedirectViaRootDir: false,
    })),
    filterDiagnosticsForSurface: actual.filterDiagnosticsForSurface,
    remainingDeadlineBudgetMs: (deadlineEpochMs: number) =>
      mockState.shouldExpireDeadline ? 0 : actual.remainingDeadlineBudgetMs(deadlineEpochMs),
  };
});

vi.mock("../src/cli/utils/json-mode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/utils/json-mode.js")>()),
  enableJsonMode: vi.fn(),
  setJsonReportDirectory: vi.fn(),
  setJsonReportMode: vi.fn(),
  writeJsonReport: vi.fn((report: JsonReport) => mockState.jsonReports.push(report)),
}));

vi.mock("../src/inspect.js", () => {
  const inspect = vi.fn(
    async (
      directory: string,
      options: {
        readonly deadCode?: boolean;
        readonly excludedProjectDirectories?: ReadonlyArray<string>;
        readonly retainExcludedProjectDeadCodeDiagnostics?: boolean;
      },
    ): Promise<InspectResult> => {
      mockState.inspectInvocations.push({
        directory,
        deadCode: options.deadCode,
        excludedProjectDirectories: options.excludedProjectDirectories ?? [],
        retainExcludedProjectDeadCodeDiagnostics:
          options.retainExcludedProjectDeadCodeDiagnostics ?? false,
      });
      if (mockState.result === undefined) throw new Error("mockState.result not set");
      return mockState.result;
    },
  );
  return {
    inspect,
    createInvocationInspect: () => inspect,
  };
});

vi.mock("../src/cli/utils/select-projects.js", () => ({
  selectProjects: vi.fn(async () => mockState.projectDirectories),
}));

vi.mock("../src/cli/utils/should-skip-prompts.js", () => ({
  shouldSkipPrompts: vi.fn(() => true),
}));

vi.mock("../src/cli/utils/prompt-install-setup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli/utils/prompt-install-setup.js")>();
  return {
    ...actual,
    shouldShowAgentInstallHint: vi.fn(() => false),
  };
});

const buildResult = (
  projectDirectory: string,
  overrides: Partial<InspectResult> = {},
): InspectResult => ({
  diagnostics: [],
  score: null,
  skippedChecks: [],
  project: buildTestProject({ rootDirectory: projectDirectory }),
  elapsedMilliseconds: 1,
  scannedFileCount: 2,
  analyzedFiles: ["src/app.tsx", "src/widget.tsx"],
  ...overrides,
});

const HARD_LINT_FAILURE: Partial<InspectResult> = {
  skippedChecks: ["lint"],
  skippedCheckReasons: { lint: "Failed to parse oxlint output: Error running JS plugin." },
  analyzedFiles: [],
};

describe("inspectAction exit-code gate", () => {
  let projectDirectory: string;
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-exit-code-"));
    mockState.projectDirectories = [projectDirectory];
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    mockState.result = undefined;
    mockState.projectDirectories = [];
    mockState.inspectInvocations = [];
    mockState.resolvedDirectories.clear();
    mockState.userConfig = undefined;
    mockState.jsonReports.length = 0;
    mockState.shouldExpireDeadline = false;
    fs.rmSync(projectDirectory, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const runInspectAction = async (
    resultOverrides: Partial<InspectResult>,
    flags: InspectFlags = {},
  ): Promise<void> => {
    mockState.result = buildResult(projectDirectory, resultOverrides);
    await inspectAction(projectDirectory, flags);
  };

  it("exits 1 when the lint pass hard-failed under default blocking", async () => {
    await runInspectAction(HARD_LINT_FAILURE);
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 on a hard lint failure even in `--score` mode", async () => {
    await runInspectAction(HARD_LINT_FAILURE, { score: true });
    expect(process.exitCode).toBe(1);
  });

  it("keeps `--blocking none` advisory even on a hard lint failure", async () => {
    await runInspectAction(HARD_LINT_FAILURE, { blocking: "none" });
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 0 on a healthy `--no-lint` run (no lint coverage, nothing skipped)", async () => {
    await runInspectAction({ analyzedFiles: [] }, { lint: false });
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 0 when `--max-duration` truncated the lint pass (`lint:partial`)", async () => {
    await runInspectAction({
      analyzedFiles: ["src/app.tsx"],
      skippedCheckReasons: { "lint:partial": "1 file was skipped after the scan budget ran out." },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("lists workspace projects that never started before max-duration elapsed", async () => {
    const secondProjectDirectory = path.join(projectDirectory, "apps", "admin");
    fs.mkdirSync(secondProjectDirectory, { recursive: true });
    mockState.projectDirectories = [projectDirectory, secondProjectDirectory];
    mockState.shouldExpireDeadline = true;

    await inspectAction(projectDirectory, { json: true, maxDuration: "1" });

    expect(mockState.inspectInvocations).toEqual([]);
    expect(mockState.jsonReports).toHaveLength(1);
    expect(mockState.jsonReports[0]?.skippedProjects).toEqual([
      { directory: projectDirectory, reason: "max-duration" },
      { directory: secondProjectDirectory, reason: "max-duration" },
    ]);
  });

  it("exits 0 when a fail-open pass was skipped (supply-chain timeout)", async () => {
    await runInspectAction({
      skippedChecks: ["supply-chain"],
      skippedCheckReasons: { "supply-chain": "Supply-chain analysis timed out and was skipped." },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 0 on a complete clean scan", async () => {
    await runInspectAction({});
    expect(process.exitCode).toBeUndefined();
  });

  it("excludes selected descendant projects from an ancestor workspace scan", async () => {
    const nestedProjectDirectory = path.join(projectDirectory, "packages", "web");
    fs.mkdirSync(nestedProjectDirectory, { recursive: true });
    mockState.projectDirectories = [projectDirectory, nestedProjectDirectory];

    await runInspectAction({});

    expect(mockState.inspectInvocations).toContainEqual({
      directory: projectDirectory,
      deadCode: true,
      excludedProjectDirectories: [nestedProjectDirectory],
      retainExcludedProjectDeadCodeDiagnostics: true,
    });
    expect(mockState.inspectInvocations).toContainEqual({
      directory: nestedProjectDirectory,
      deadCode: false,
      excludedProjectDirectories: [],
      retainExcludedProjectDeadCodeDiagnostics: false,
    });
  });

  it("computes workspace exclusions from unique resolved project roots", async () => {
    const configuredProjectDirectory = path.join(projectDirectory, "packages", "web");
    const configuredProjectAliasDirectory = path.join(projectDirectory, "packages", "web-alias");
    const resolvedProjectDirectory = path.join(projectDirectory, "apps", "web");
    fs.mkdirSync(configuredProjectDirectory, { recursive: true });
    fs.mkdirSync(configuredProjectAliasDirectory, { recursive: true });
    fs.mkdirSync(resolvedProjectDirectory, { recursive: true });
    mockState.projectDirectories = [
      projectDirectory,
      configuredProjectDirectory,
      configuredProjectAliasDirectory,
    ];
    mockState.resolvedDirectories.set(configuredProjectDirectory, resolvedProjectDirectory);
    mockState.resolvedDirectories.set(configuredProjectAliasDirectory, resolvedProjectDirectory);

    await runInspectAction({});

    expect(mockState.inspectInvocations).toContainEqual({
      directory: projectDirectory,
      deadCode: true,
      excludedProjectDirectories: [resolvedProjectDirectory],
      retainExcludedProjectDeadCodeDiagnostics: true,
    });
    expect(mockState.inspectInvocations).toContainEqual({
      directory: resolvedProjectDirectory,
      deadCode: false,
      excludedProjectDirectories: [],
      retainExcludedProjectDeadCodeDiagnostics: false,
    });
    expect(mockState.inspectInvocations).toHaveLength(2);
  });

  it("still exits 1 when a complete scan has a blocking finding", async () => {
    await runInspectAction({ diagnostics: [buildDiagnostic({ severity: "error" })] });
    expect(process.exitCode).toBe(1);
  });

  it("does not fail CI for an error in a Radix test file by default", async () => {
    await runInspectAction({
      diagnostics: [
        buildDiagnostic({
          filePath: "packages/react/context-menu/src/context-menu-controlled.test.tsx",
          plugin: "eslint",
          rule: "no-unused-vars",
          severity: "error",
          category: "Bugs",
          fileContext: "test",
        }),
      ],
    });

    expect(process.exitCode).toBeUndefined();
  });

  it("fails CI when the Radix test diagnostic is explicitly included", async () => {
    mockState.userConfig = {
      surfaces: { ciFailure: { includeRules: ["eslint/no-unused-vars"] } },
    };
    await runInspectAction({
      diagnostics: [
        buildDiagnostic({
          filePath: "packages/react/context-menu/src/context-menu-controlled.test.tsx",
          plugin: "eslint",
          rule: "no-unused-vars",
          severity: "error",
          category: "Bugs",
          fileContext: "test",
        }),
      ],
    });

    expect(process.exitCode).toBe(1);
  });

  it("fails CI when test diagnostics are included by file context", async () => {
    mockState.userConfig = {
      surfaces: { ciFailure: { includeFileContexts: ["test"] } },
    };
    await runInspectAction({
      diagnostics: [
        buildDiagnostic({
          filePath: "packages/react/context-menu/src/context-menu-controlled.test.tsx",
          plugin: "eslint",
          rule: "no-unused-vars",
          severity: "error",
          category: "Bugs",
          fileContext: "test",
        }),
      ],
    });

    expect(process.exitCode).toBe(1);
  });

  it("keeps `--blocking none` advisory for blocking findings", async () => {
    await runInspectAction(
      { diagnostics: [buildDiagnostic({ severity: "error" })] },
      { blocking: "none" },
    );
    expect(process.exitCode).toBeUndefined();
  });
});
