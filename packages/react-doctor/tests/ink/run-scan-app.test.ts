import * as path from "node:path";
import * as Effect from "effect/Effect";
import { render } from "ink";
import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  DiffInfo,
  InspectResult,
  ResolvedScanTarget,
  WorkspacePackage,
} from "@react-doctor/core";
import { getBaselineDiffPlan, getDiffInfo, Reporter, resolveScanTarget } from "@react-doctor/core";
import { runScanApp } from "../../src/cli/ink/run-scan-app.js";
import type { ScanStore, TuiHandoffRequest } from "../../src/cli/ink/scan-store.js";
import { preserveActiveTuiRendererOutput } from "../../src/cli/utils/active-tui-renderer.js";
import { computeProjectedScore } from "../../src/cli/utils/compute-score-projection.js";
import { inspect } from "../../src/inspect.js";
import { buildDiagnostic, buildTestProject } from "../regressions/_helpers.js";

interface MockScanAppProps {
  readonly store?: ScanStore;
  readonly displayMode?: "scan" | "report";
  readonly onHandoff?: (request: TuiHandoffRequest) => void;
  readonly canAddToCi?: boolean;
  readonly onAddToCi?: () => void;
  readonly onQuit?: () => void;
}

interface MockProjectSelectProps {
  readonly packages?: ReadonlyArray<WorkspacePackage>;
  readonly onSubmit?: (directories: string[]) => void;
}

const mockState = vi.hoisted(() => ({
  projectDirectories: new Array<string>(),
  workspacePackages: new Array<WorkspacePackage>(),
  scanTargets: new Map<string, ResolvedScanTarget>(),
  inspectResults: new Map<string, InspectResult>(),
  shouldRequestHandoff: false,
  shouldSetUpCi: false,
  shouldQuit: false,
  shouldAutoSubmitProjectSelection: true,
  scanRendererClearCount: 0,
  lifecycleEvents: new Array<string>(),
  scanStores: new Array<ScanStore>(),
  initialProgressStates: new Array<string | null>(),
  ciRecommendationStates: new Array<boolean>(),
}));

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  const React = await import("react");
  return {
    ...actual,
    render: vi.fn((node) => {
      if (
        React.isValidElement<MockProjectSelectProps>(node) &&
        node.props.packages &&
        mockState.shouldAutoSubmitProjectSelection
      ) {
        queueMicrotask(() => node.props.onSubmit?.(mockState.projectDirectories));
      }
      if (React.isValidElement<MockScanAppProps>(node)) {
        if (node.props.store && node.props.displayMode === "scan") {
          mockState.scanStores.push(node.props.store);
          mockState.initialProgressStates.push(node.props.store.getSnapshot().progress);
        }
        if (node.props.displayMode === "report") {
          mockState.ciRecommendationStates.push(Boolean(node.props.canAddToCi));
        }
        if (mockState.shouldRequestHandoff && node.props.displayMode === "report") {
          node.props.onHandoff?.({ agentId: "codex", prompt: "fix" });
        }
        if (mockState.shouldSetUpCi && node.props.displayMode === "report") {
          node.props.onAddToCi?.();
        }
        if (mockState.shouldQuit && node.props.displayMode === "report") node.props.onQuit?.();
      }
      return {
        clear: vi.fn(() => {
          if (React.isValidElement<MockScanAppProps>(node)) mockState.scanRendererClearCount += 1;
        }),
        unmount: vi.fn(),
        waitUntilExit: vi.fn(async () => {}),
      };
    }),
  };
});

vi.mock("@react-doctor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-doctor/core")>();
  return {
    ...actual,
    resolveScanTarget: vi.fn(async (requestedDirectory: string) => {
      const target = mockState.scanTargets.get(requestedDirectory);
      if (!target) throw new Error(`Missing scan target for ${requestedDirectory}`);
      return target;
    }),
    mapWithConcurrency: vi.fn(
      async <Input, Output>(
        inputs: ReadonlyArray<Input>,
        _concurrency: number,
        mapInput: (input: Input) => Promise<Output>,
      ): Promise<Output[]> => Promise.all(inputs.map(mapInput)),
    ),
    getBaselineDiffPlan: vi.fn(),
    getDiffInfo: vi.fn(),
  };
});

vi.mock("../../src/cli/utils/collect-project-source-file-counts.js", () => ({
  collectProjectSourceFileCounts: vi.fn(
    async (_rootDirectory: string, projectDirectories: ReadonlyArray<string>) =>
      new Map(projectDirectories.map((projectDirectory) => [projectDirectory, 0])),
  ),
}));

vi.mock("../../src/inspect.js", () => {
  const inspect = vi.fn(async (directory: string): Promise<InspectResult> => {
    const result = mockState.inspectResults.get(directory);
    if (!result) throw new Error(`Missing inspect result for ${directory}`);
    return result;
  });
  return {
    inspect,
    createInvocationInspect: () => inspect,
  };
});

vi.mock("../../src/cli/utils/select-projects.js", () => ({
  discoverWorkspacePackages: vi.fn(() => mockState.workspacePackages),
  selectProjects: vi.fn(async () => mockState.projectDirectories),
}));

vi.mock("../../src/cli/utils/detect-launchable-agents.js", () => ({
  detectLaunchableAgents: vi.fn(async () => []),
}));

vi.mock("../../src/cli/utils/install-github-workflow.js", () => ({
  isReactDoctorWorkflowInstalled: vi.fn(() => true),
}));

vi.mock("../../src/cli/utils/set-up-github-actions.js", () => ({
  setUpGitHubActions: vi.fn(async () => {
    mockState.lifecycleEvents.push("ci");
    return true;
  }),
}));

vi.mock("../../src/cli/utils/print-footer.js", () => ({
  printFooter: vi.fn(() => Effect.sync(() => mockState.lifecycleEvents.push("footer"))),
}));

vi.mock("../../src/cli/utils/launch-agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/utils/launch-agent.js")>();
  return {
    ...actual,
    launchCliAgent: vi.fn(async () => {
      mockState.lifecycleEvents.push("handoff");
    }),
  };
});

vi.mock("../../src/cli/utils/compute-score-projection.js", () => ({
  computeProjectedScore: vi.fn(async () => null),
}));

vi.mock("../../src/cli/utils/is-ci-environment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/utils/is-ci-environment.js")>();
  return { ...actual, isCiEnvironment: vi.fn(() => false) };
});

const buildScanTarget = (
  requestedDirectory: string,
  resolvedDirectory: string,
  userConfig: ResolvedScanTarget["userConfig"],
  configSourceDirectory: string,
): ResolvedScanTarget => ({
  requestedDirectory,
  resolvedDirectory,
  userConfig,
  configSourceDirectory,
  didRedirectViaRootDir: requestedDirectory !== resolvedDirectory,
});

const buildInspectResult = (directory: string): InspectResult => ({
  diagnostics: [],
  score: null,
  skippedChecks: [],
  project: buildTestProject({ rootDirectory: directory, projectName: path.basename(directory) }),
  elapsedMilliseconds: 1,
  scannedFileCount: 1,
  scannedFilePaths: [path.join(directory, "src", "app.tsx")],
});

describe("runScanApp", () => {
  afterEach(() => {
    mockState.projectDirectories.length = 0;
    mockState.workspacePackages.length = 0;
    mockState.scanTargets.clear();
    mockState.inspectResults.clear();
    mockState.shouldRequestHandoff = false;
    mockState.shouldSetUpCi = false;
    mockState.shouldQuit = false;
    mockState.shouldAutoSubmitProjectSelection = true;
    mockState.scanRendererClearCount = 0;
    mockState.lifecycleEvents.length = 0;
    mockState.scanStores.length = 0;
    mockState.initialProgressStates.length = 0;
    mockState.ciRecommendationStates.length = 0;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uses a disposable screen for project selection", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const originalIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    mockState.workspacePackages.push(
      { name: "web", directory: "/repo/apps/web" },
      { name: "admin", directory: "/repo/apps/admin" },
    );
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );

    try {
      await runScanApp({ directory: rootDirectory });
    } finally {
      if (originalIsTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalIsTtyDescriptor);
      } else {
        delete process.stdin.isTTY;
      }
    }

    expect(vi.mocked(render).mock.calls[0]?.[1]).toEqual({
      alternateScreen: true,
      exitOnCtrlC: false,
    });
  });

  it("preserves the active screen in scrollback when exiting", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const originalIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    mockState.workspacePackages.push(
      { name: "web", directory: "/repo/apps/web" },
      { name: "admin", directory: "/repo/apps/admin" },
    );
    mockState.shouldAutoSubmitProjectSelection = false;
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );

    try {
      const scanPromise = runScanApp({ directory: rootDirectory });
      await vi.waitFor(() => expect(render).toHaveBeenCalled());
      const selectionRenderer = vi.mocked(render).mock.results[0]?.value;

      preserveActiveTuiRendererOutput();

      expect(selectionRenderer?.clear).not.toHaveBeenCalled();
      expect(selectionRenderer?.unmount).toHaveBeenCalledOnce();
      const selectionNode = vi.mocked(render).mock.calls[0]?.[0];
      if (isValidElement<MockProjectSelectProps>(selectionNode)) {
        selectionNode.props.onSubmit?.([]);
      }
      await scanPromise;
      expect(selectionRenderer?.clear).not.toHaveBeenCalled();
      expect(selectionRenderer?.unmount).toHaveBeenCalledOnce();
    } finally {
      if (originalIsTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalIsTtyDescriptor);
      } else {
        delete process.stdin.isTTY;
      }
    }
  });

  it("keeps scanning and report navigation inline", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, buildInspectResult(rootDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(vi.mocked(render).mock.calls[0]?.[1]).toEqual({
      alternateScreen: false,
      exitOnCtrlC: false,
    });
    expect(vi.mocked(render).mock.calls[1]?.[1]).toEqual({
      alternateScreen: false,
      exitOnCtrlC: false,
    });
    expect(vi.mocked(render).mock.calls[0]?.[0]).toMatchObject({
      props: { displayMode: "scan" },
    });
    expect(vi.mocked(render).mock.calls[1]?.[0]).toMatchObject({
      props: { displayMode: "report" },
    });
  });

  it("explains that an incomplete scan suppressed the score", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      skippedChecks: ["dead-code"],
      skippedCheckReasons: { "dead-code": "Dead-code analysis failed." },
    });

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.scanStores[0]?.getSnapshot().report?.noScoreMessage).toContain(
      "lint or dead-code analysis could not complete",
    );
    expect(mockState.scanStores[0]?.getSnapshot().report?.noScoreMessage).not.toContain(
      "score API",
    );
  });

  it("does not blame a score API failure on unrelated skipped checks", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      skippedChecks: ["supply-chain"],
      skippedCheckReasons: { "supply-chain": "Supply-chain analysis failed." },
    });

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.scanStores[0]?.getSnapshot().report?.noScoreMessage).toContain("score API");
    expect(mockState.scanStores[0]?.getSnapshot().report?.noScoreMessage).not.toContain(
      "lint or dead-code analysis could not complete",
    );
  });

  it("excludes nested projects from an ancestor scan", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const webDirectory = "/repo/apps/web";
    mockState.projectDirectories.push(rootDirectory, webDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      webDirectory,
      buildScanTarget(webDirectory, webDirectory, null, webDirectory),
    );
    mockState.inspectResults.set(rootDirectory, buildInspectResult(rootDirectory));
    mockState.inspectResults.set(webDirectory, buildInspectResult(webDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.initialProgressStates).toEqual(["Indexing workspace files…"]);
    expect(inspect).toHaveBeenCalledWith(
      rootDirectory,
      expect.objectContaining({
        deadCode: true,
        excludedProjectDirectories: [webDirectory],
        precomputedSourceFileCount: 0,
        retainExcludedProjectDeadCodeDiagnostics: true,
        uiLayers: expect.objectContaining({ progress: expect.anything() }),
      }),
    );
    expect(inspect).toHaveBeenCalledWith(
      webDirectory,
      expect.objectContaining({
        deadCode: false,
        excludedProjectDirectories: [],
        retainExcludedProjectDeadCodeDiagnostics: false,
      }),
    );
  });

  it("preserves workspace dead-code ownership when a scoped scan skips the root", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const webDirectory = "/repo/apps/web";
    const diffInfo: DiffInfo = {
      currentBranch: "feature",
      baseBranch: "main",
      changedFiles: ["apps/web/package.json"],
      isCurrentChanges: true,
    };
    vi.mocked(getDiffInfo).mockResolvedValue(diffInfo);
    mockState.projectDirectories.push(rootDirectory, webDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      webDirectory,
      buildScanTarget(webDirectory, webDirectory, null, webDirectory),
    );
    mockState.inspectResults.set(webDirectory, buildInspectResult(webDirectory));

    await runScanApp({
      directory: rootDirectory,
      flags: { scope: "files" },
      skipPrompts: true,
    });

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(
      webDirectory,
      expect.objectContaining({ deadCode: false }),
    );
  });

  it("excludes unchanged nested projects from a scoped ancestor scan", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const webDirectory = "/repo/apps/web";
    const diffInfo: DiffInfo = {
      currentBranch: "feature",
      baseBranch: "main",
      changedFiles: ["src/app.tsx"],
      isCurrentChanges: true,
    };
    vi.mocked(getDiffInfo).mockResolvedValue(diffInfo);
    mockState.projectDirectories.push(rootDirectory, webDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      webDirectory,
      buildScanTarget(webDirectory, webDirectory, null, webDirectory),
    );
    mockState.inspectResults.set(rootDirectory, buildInspectResult(rootDirectory));

    await runScanApp({
      directory: rootDirectory,
      flags: { scope: "files" },
      skipPrompts: true,
    });

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(
      rootDirectory,
      expect.objectContaining({ excludedProjectDirectories: [webDirectory] }),
    );
  });

  it("scans aliased selections that resolve to one project root once", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const requestedWebDirectory = "/repo/apps/web";
    const requestedWebAliasDirectory = "/repo/packages/web";
    const resolvedWebDirectory = "/repo/apps/web/client";
    mockState.projectDirectories.push(requestedWebDirectory, requestedWebAliasDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      requestedWebDirectory,
      buildScanTarget(requestedWebDirectory, resolvedWebDirectory, null, requestedWebDirectory),
    );
    mockState.scanTargets.set(
      requestedWebAliasDirectory,
      buildScanTarget(
        requestedWebAliasDirectory,
        resolvedWebDirectory,
        null,
        requestedWebAliasDirectory,
      ),
    );
    mockState.inspectResults.set(resolvedWebDirectory, buildInspectResult(resolvedWebDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(resolvedWebDirectory, expect.anything());
  });

  it("merges root and project configs while sharing one scan deadline", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockState.shouldRequestHandoff = true;
    const rootDirectory = "/repo";
    const requestedWebDirectory = "/repo/apps/web";
    const requestedAdminDirectory = "/repo/apps/admin";
    const resolvedWebDirectory = "/repo/apps/web/client";
    const rootConfigDirectory = "/repo";
    const adminConfigDirectory = "/repo/apps/admin";

    mockState.projectDirectories.push(requestedWebDirectory, requestedAdminDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, { warnings: false }, rootConfigDirectory),
    );
    mockState.scanTargets.set(
      requestedWebDirectory,
      buildScanTarget(
        requestedWebDirectory,
        resolvedWebDirectory,
        { deadCode: false },
        requestedWebDirectory,
      ),
    );
    mockState.scanTargets.set(
      requestedAdminDirectory,
      buildScanTarget(
        requestedAdminDirectory,
        requestedAdminDirectory,
        { noScore: true, plugins: ["./plugin.js"] },
        adminConfigDirectory,
      ),
    );
    mockState.inspectResults.set(resolvedWebDirectory, buildInspectResult(resolvedWebDirectory));
    mockState.inspectResults.set(requestedAdminDirectory, {
      ...buildInspectResult(requestedAdminDirectory),
      skippedChecks: ["lint"],
      skippedCheckReasons: { lint: "Oxlint failed." },
    });

    const result = await runScanApp({
      directory: rootDirectory,
      options: { maxDurationMs: 1_000 },
      skipPrompts: true,
    });

    expect(mockState.scanStores[0]?.getSnapshot().summary?.projects[1]?.skippedChecks).toEqual([
      "lint",
    ]);
    expect(resolveScanTarget).toHaveBeenCalledWith(rootDirectory, {
      allowAmbiguous: true,
    });
    expect(resolveScanTarget).toHaveBeenCalledWith(requestedWebDirectory, {
      allowAmbiguous: true,
    });
    expect(resolveScanTarget).toHaveBeenCalledWith(requestedAdminDirectory, {
      allowAmbiguous: true,
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenNthCalledWith(
      1,
      resolvedWebDirectory,
      expect.objectContaining({
        configOverride: expect.objectContaining({ warnings: false, deadCode: false }),
        configSourceDirectory: rootConfigDirectory,
      }),
    );
    expect(inspect).toHaveBeenNthCalledWith(
      2,
      requestedAdminDirectory,
      expect.objectContaining({
        configOverride: expect.objectContaining({
          warnings: false,
          noScore: true,
          plugins: ["./plugin.js"],
        }),
        configSourceDirectory: adminConfigDirectory,
      }),
    );
    const firstOptions = vi.mocked(inspect).mock.calls[0]?.[1];
    const secondOptions = vi.mocked(inspect).mock.calls[1]?.[1];
    expect(firstOptions?.uiLayers?.reporter).toBe(Reporter.layerNoop);
    expect(secondOptions?.uiLayers?.reporter).toBe(Reporter.layerNoop);
    expect(firstOptions?.noScore).toBeUndefined();
    expect(secondOptions?.noScore).toBeUndefined();
    expect(firstOptions?.deadlineEpochMs).toBe(secondOptions?.deadlineEpochMs);
    expect(firstOptions?.deadlineEpochMs).toBeTypeOf("number");
    expect(mockState.lifecycleEvents).toEqual(["footer", "handoff"]);
    expect(result.shouldFail).toBe(true);
  });

  it("does not start queued project scans after the shared deadline", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const webDirectory = "/repo/apps/web";
    const adminDirectory = "/repo/apps/admin";
    mockState.projectDirectories.push(webDirectory, adminDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      webDirectory,
      buildScanTarget(webDirectory, webDirectory, null, webDirectory),
    );
    mockState.scanTargets.set(
      adminDirectory,
      buildScanTarget(adminDirectory, adminDirectory, null, adminDirectory),
    );

    const result = await runScanApp({
      directory: rootDirectory,
      options: { deadlineEpochMs: Date.now() - 1 },
      skipPrompts: true,
    });

    expect(inspect).not.toHaveBeenCalled();
    expect(mockState.scanStores[0]?.getSnapshot().summary?.projects).toEqual([]);
    expect(mockState.scanStores[0]?.getSnapshot().summary?.skippedProjects).toEqual([
      { directory: adminDirectory, reason: "max-duration" },
      { directory: webDirectory, reason: "max-duration" },
    ]);
    expect(result.shouldFail).toBe(false);
  });

  it("uses the configured blocking level and ciFailure surface for the exit gate", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, { blocking: "none" }, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      diagnostics: [buildDiagnostic({ severity: "error" })],
      skippedChecks: ["lint"],
      skippedCheckReasons: { lint: "Oxlint failed." },
    });

    const advisoryResult = await runScanApp({ directory: rootDirectory, skipPrompts: true });
    expect(advisoryResult.shouldFail).toBe(false);

    const flagOverrideResult = await runScanApp({
      directory: rootDirectory,
      skipPrompts: true,
      blocking: "warning",
    });
    expect(flagOverrideResult.shouldFail).toBe(true);
    expect(vi.mocked(inspect).mock.calls.at(-1)?.[1]?.warnings).toBe(true);

    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(
        rootDirectory,
        rootDirectory,
        {
          blocking: "error",
          surfaces: { ciFailure: { excludeRules: ["react-doctor/test-rule"] } },
        },
        rootDirectory,
      ),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      diagnostics: [buildDiagnostic({ severity: "error" })],
    });

    const surfaceExcludedResult = await runScanApp({
      directory: rootDirectory,
      skipPrompts: true,
    });
    expect(surfaceExcludedResult.shouldFail).toBe(false);
  });

  it("keeps diagnostics advisory when an intended baseline cannot be computed", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const diffInfo: DiffInfo = {
      currentBranch: "feature",
      baseBranch: "main",
      diffBaseRef: "base-commit",
      changedFiles: ["src/app.tsx"],
      isCurrentChanges: false,
    };
    vi.mocked(getDiffInfo).mockResolvedValue(diffInfo);
    vi.mocked(getBaselineDiffPlan).mockResolvedValue(null);
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      diagnostics: [buildDiagnostic({ severity: "error" })],
    });

    const result = await runScanApp({
      directory: rootDirectory,
      flags: { scope: "changed" },
      skipPrompts: true,
    });

    expect(result.shouldFail).toBe(false);
  });

  it("applies the CLI surface and category filter to the TUI report", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(
        rootDirectory,
        rootDirectory,
        {
          surfaces: {
            cli: { excludeRules: ["react-doctor/hidden-security"] },
            score: { excludeRules: ["react-doctor/hidden-security"] },
          },
        },
        rootDirectory,
      ),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      score: { score: 72, label: "Fair" },
      diagnostics: [
        buildDiagnostic({ rule: "visible-security", category: "Security" }),
        buildDiagnostic({ rule: "hidden-security", category: "Security" }),
        buildDiagnostic({ rule: "visible-performance", category: "Performance" }),
      ],
    });

    await runScanApp({
      directory: rootDirectory,
      options: { categoryFilters: ["Security"] },
      skipPrompts: true,
    });

    expect(mockState.scanStores[0]?.getSnapshot().report?.diagnostics).toEqual([
      expect.objectContaining({ rule: "visible-security" }),
    ]);
    expect(vi.mocked(computeProjectedScore)).toHaveBeenCalledWith(
      [expect.objectContaining({ rule: "visible-security" })],
      [
        expect.objectContaining({ rule: "visible-security" }),
        expect.objectContaining({ rule: "visible-performance" }),
      ],
      { score: 72, label: "Fair" },
    );
  });

  it("explains when a category filter leaves the TUI report empty", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, {
      ...buildInspectResult(rootDirectory),
      diagnostics: [buildDiagnostic({ category: "Performance" })],
    });

    await runScanApp({
      directory: rootDirectory,
      options: { categoryFilters: ["Security"] },
      skipPrompts: true,
    });

    expect(mockState.scanStores[0]?.getSnapshot().report).toEqual(
      expect.objectContaining({
        diagnostics: [],
        emptyStateMessage: "No issues found in category Security!",
      }),
    );
  });

  it("does not print the scan footer after the user quits", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.shouldQuit = true;
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, buildInspectResult(rootDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.lifecycleEvents).not.toContain("footer");
    expect(mockState.scanRendererClearCount).toBe(2);
  });

  it("runs confirmed CI setup even when the user quits", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.shouldSetUpCi = true;
    mockState.shouldQuit = true;
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, buildInspectResult(rootDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.lifecycleEvents).toContain("ci");
    expect(mockState.lifecycleEvents).not.toContain("footer");
  });

  it("runs queued CI setup after a completed selection", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    mockState.shouldSetUpCi = true;
    mockState.projectDirectories.push(rootDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.inspectResults.set(rootDirectory, buildInspectResult(rootDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.lifecycleEvents).toContain("ci");
  });

  it("normalizes project-qualified diagnostic paths", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const webDirectory = "/repo/apps/web";
    const adminDirectory = "/repo/apps/admin";

    mockState.projectDirectories.push(webDirectory, adminDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      webDirectory,
      buildScanTarget(webDirectory, webDirectory, null, webDirectory),
    );
    mockState.scanTargets.set(
      adminDirectory,
      buildScanTarget(adminDirectory, adminDirectory, null, adminDirectory),
    );
    mockState.inspectResults.set(webDirectory, {
      ...buildInspectResult(webDirectory),
      diagnostics: [buildDiagnostic({ filePath: "src\\app.tsx" })],
    });
    mockState.inspectResults.set(adminDirectory, buildInspectResult(adminDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.scanStores[0]?.getSnapshot().summary?.combinedDiagnostics[0]?.filePath).toBe(
      "apps/web/src/app.tsx",
    );
  });

  it("recommends GitHub Actions after scanning multiple projects", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const rootDirectory = "/repo";
    const webDirectory = "/repo/apps/web";
    const adminDirectory = "/repo/apps/admin";

    mockState.projectDirectories.push(webDirectory, adminDirectory);
    mockState.scanTargets.set(
      rootDirectory,
      buildScanTarget(rootDirectory, rootDirectory, null, rootDirectory),
    );
    mockState.scanTargets.set(
      webDirectory,
      buildScanTarget(webDirectory, webDirectory, null, webDirectory),
    );
    mockState.scanTargets.set(
      adminDirectory,
      buildScanTarget(adminDirectory, adminDirectory, null, adminDirectory),
    );
    mockState.inspectResults.set(webDirectory, buildInspectResult(webDirectory));
    mockState.inspectResults.set(adminDirectory, buildInspectResult(adminDirectory));

    await runScanApp({ directory: rootDirectory, skipPrompts: true });

    expect(mockState.ciRecommendationStates).toEqual([true]);
  });
});
