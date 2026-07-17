import * as path from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult, ResolvedScanTarget } from "@react-doctor/core";
import { resolveScanTarget } from "@react-doctor/core";
import { runScanApp } from "../../src/cli/ink/run-scan-app.js";
import { inspect } from "../../src/inspect.js";
import { buildTestProject } from "../regressions/_helpers.js";

const mockState = vi.hoisted(() => ({
  projectDirectories: new Array<string>(),
  scanTargets: new Map<string, ResolvedScanTarget>(),
  inspectResults: new Map<string, InspectResult>(),
}));

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: vi.fn(() => ({
      clear: vi.fn(),
      unmount: vi.fn(),
      waitUntilExit: vi.fn(async () => {}),
    })),
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
  };
});

vi.mock("../../src/inspect.js", () => ({
  inspect: vi.fn(async (directory: string): Promise<InspectResult> => {
    const result = mockState.inspectResults.get(directory);
    if (!result) throw new Error(`Missing inspect result for ${directory}`);
    return result;
  }),
}));

vi.mock("../../src/cli/utils/select-projects.js", () => ({
  discoverWorkspacePackages: vi.fn(() => []),
  selectProjects: vi.fn(async () => mockState.projectDirectories),
}));

vi.mock("../../src/cli/utils/detect-launchable-agents.js", () => ({
  detectLaunchableAgents: vi.fn(async () => []),
}));

vi.mock("../../src/cli/utils/install-github-workflow.js", () => ({
  isReactDoctorWorkflowInstalled: vi.fn(() => true),
}));

vi.mock("../../src/cli/utils/render-summary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/utils/render-summary.js")>();
  return { ...actual, printFooter: vi.fn(() => Effect.void) };
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
    mockState.scanTargets.clear();
    mockState.inspectResults.clear();
    vi.restoreAllMocks();
  });

  it("merges root and project configs while sharing one scan deadline", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
        { plugins: ["./plugin.js"] },
        adminConfigDirectory,
      ),
    );
    mockState.inspectResults.set(resolvedWebDirectory, buildInspectResult(resolvedWebDirectory));
    mockState.inspectResults.set(
      requestedAdminDirectory,
      buildInspectResult(requestedAdminDirectory),
    );

    await runScanApp({
      directory: rootDirectory,
      options: { maxDurationMs: 1_000 },
      skipPrompts: true,
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
        configOverride: expect.objectContaining({ warnings: false, plugins: ["./plugin.js"] }),
        configSourceDirectory: adminConfigDirectory,
      }),
    );
    const firstOptions = vi.mocked(inspect).mock.calls[0]?.[1];
    const secondOptions = vi.mocked(inspect).mock.calls[1]?.[1];
    expect(firstOptions?.deadlineEpochMs).toBe(secondOptions?.deadlineEpochMs);
    expect(firstOptions?.deadlineEpochMs).toBeTypeOf("number");
  });
});
