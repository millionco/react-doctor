import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV,
  type InspectResult,
  type JsonReport,
  type ReactDoctorConfig,
} from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import type { InspectFlags } from "../src/cli/utils/inspect-flags.js";
import { handleError } from "../src/cli/utils/handle-error.js";
import { runStagedInspect } from "../src/cli/utils/run-staged-inspect.js";
import { inspect } from "../src/inspect.js";
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
  lifecycleEvents: new Array<string>(),
}));

const mockDisposeInvocation = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../src/cli/utils/create-cli-invocation-inspect.js", async () => {
  const { inspect } = await import("../src/inspect.js");
  return {
    createCliInvocationInspect: vi.fn(() => ({
      inspectProject: inspect,
      dispose: mockDisposeInvocation,
    })),
  };
});

vi.mock("../src/cli/utils/handle-error.js", () => ({
  handleError: vi.fn(),
  handleUserError: vi.fn(),
}));

vi.mock("../src/cli/utils/report-error.js", () => ({
  reportErrorToSentry: vi.fn(async () => undefined),
}));

vi.mock("../src/cli/utils/find-staged-snapshot-divergences.js", () => ({
  findStagedSnapshotDivergences: vi.fn(() => []),
}));

vi.mock("../src/cli/utils/run-staged-inspect.js", () => ({
  runStagedInspect: vi.fn(async () => {}),
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
    isNativeOxlintRequired: () => process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] === "1",
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
  let savedNativeOxlintRequired: string | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    savedNativeOxlintRequired = process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
    process.exitCode = undefined;
    delete process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
    projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-exit-code-"));
    mockState.projectDirectories = [projectDirectory];
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    if (savedNativeOxlintRequired === undefined) {
      delete process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV];
    } else {
      process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = savedNativeOxlintRequired;
    }
    mockState.result = undefined;
    mockState.projectDirectories = [];
    mockState.inspectInvocations = [];
    mockState.resolvedDirectories.clear();
    mockState.userConfig = undefined;
    mockState.jsonReports.length = 0;
    mockState.shouldExpireDeadline = false;
    mockState.lifecycleEvents.length = 0;
    mockDisposeInvocation.mockReset();
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

  it.each([1, 2])("awaits all %i project scans before disposing the invocation", async (count) => {
    const directories = [projectDirectory, path.join(projectDirectory, "apps", "admin")].slice(
      0,
      count,
    );
    for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
    mockState.projectDirectories = directories;
    const pendingScans = directories.map((directory) => ({
      directory,
      ...Promise.withResolvers<InspectResult>(),
    }));
    for (const pending of pendingScans) {
      vi.mocked(inspect).mockImplementationOnce(async () => {
        const result = await pending.promise;
        mockState.lifecycleEvents.push(`settled:${pending.directory}`);
        return result;
      });
    }
    const disposal = Promise.withResolvers<void>();
    mockDisposeInvocation.mockReturnValueOnce(disposal.promise);
    let didFinish = false;
    const action = inspectAction(projectDirectory, { json: true }).then(() => {
      didFinish = true;
    });

    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(count));
    expect(mockDisposeInvocation).not.toHaveBeenCalled();
    for (const [index, pending] of pendingScans.entries()) {
      pending.resolve(buildResult(pending.directory));
      await vi.waitFor(() =>
        expect(mockState.lifecycleEvents).toContain(`settled:${pending.directory}`),
      );
      if (index < pendingScans.length - 1) {
        expect(mockDisposeInvocation).not.toHaveBeenCalled();
      }
    }
    await vi.waitFor(() => expect(mockDisposeInvocation).toHaveBeenCalledOnce());
    expect(didFinish).toBe(false);
    disposal.resolve();
    await action;
    expect(didFinish).toBe(true);
    expect(mockState.jsonReports).toHaveLength(1);
  });

  it("disposes an invocation without selected projects", async () => {
    mockState.projectDirectories = [];

    await inspectAction(projectDirectory, { json: true });

    expect(inspect).not.toHaveBeenCalled();
    expect(mockDisposeInvocation).toHaveBeenCalledOnce();
    expect(handleError).not.toHaveBeenCalled();
  });

  it("keeps the staged invocation alive until staged work completes", async () => {
    const pending = Promise.withResolvers<InspectResult>();
    vi.mocked(inspect).mockReturnValueOnce(pending.promise);
    vi.mocked(runStagedInspect).mockImplementationOnce(async (context) => {
      await context.inspectProject(context.scanTarget.resolvedDirectory, {});
    });
    const action = inspectAction(projectDirectory, { staged: true });

    await vi.waitFor(() => expect(inspect).toHaveBeenCalledOnce());
    expect(mockDisposeInvocation).not.toHaveBeenCalled();
    pending.resolve(buildResult(projectDirectory));
    await action;

    expect(runStagedInspect).toHaveBeenCalledOnce();
    expect(mockDisposeInvocation).toHaveBeenCalledOnce();
  });

  it("finishes disposal before an error handler can exit the process", async () => {
    const scanFailure = new Error("scan failed");
    const processExit = new Error("process exit boundary");
    const disposal = Promise.withResolvers<void>();
    vi.mocked(inspect).mockRejectedValueOnce(scanFailure);
    mockDisposeInvocation.mockImplementationOnce(async () => {
      await disposal.promise;
      mockState.lifecycleEvents.push("disposed");
    });
    vi.mocked(handleError).mockImplementationOnce(() => {
      mockState.lifecycleEvents.push("handle-error");
      throw processExit;
    });
    let observedFailure: unknown;
    const action = inspectAction(projectDirectory, {}).catch((error) => {
      observedFailure = error;
    });

    await vi.waitFor(() => expect(mockDisposeInvocation).toHaveBeenCalled());
    expect(handleError).not.toHaveBeenCalled();
    expect(observedFailure).toBeUndefined();
    disposal.resolve();
    await action;

    expect(handleError).toHaveBeenCalledWith(scanFailure, expect.anything());
    expect(mockState.lifecycleEvents).toEqual(["disposed", "handle-error"]);
    expect(observedFailure).toBe(processExit);
  });

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

  it.each(["lint", "dead-code", "security-scan"] as const)(
    "exits 1 when required native %s analysis failed under `--blocking none`",
    async (skippedCheck) => {
      process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] = "1";

      await runInspectAction({ skippedChecks: [skippedCheck] }, { blocking: "none" });

      expect(process.exitCode).toBe(1);
    },
  );

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
