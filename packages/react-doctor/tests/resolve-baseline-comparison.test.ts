import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createOxlintSpawnSlots } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { BASELINE_FILES_TEMP_DIR_PREFIX } from "../src/cli/utils/constants.js";
import { materializeBaselineFiles } from "../src/cli/utils/materialize-baseline-files.js";
import { makeNoopConsole } from "../src/cli/utils/noop-console.js";
import {
  resolveBaselineComparison,
  type ResolveBaselineComparisonInput,
} from "../src/cli/utils/resolve-baseline-comparison.js";
import { resolveInspectOptions } from "../src/cli/utils/resolve-inspect-options.js";
import type { ReactDoctorInspectOptions, ResolvedInspectOptions } from "../src/inspect-options.js";

vi.mock("../src/cli/utils/materialize-baseline-files.js", () => ({
  materializeBaselineFiles: vi.fn(),
}));

const mockedMaterializeBaselineFiles = vi.mocked(materializeBaselineFiles);

const projectInfo: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "example",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasI18nLibrary: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  preactVersion: null,
  preactMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  sourceFileCount: 1,
};

const diagnostic = (filePath: string, line: number): Diagnostic => ({
  filePath,
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
  help: "Fix the example",
  line,
  column: 1,
  category: "Correctness",
});

const resolveOptions = (inputOptions: ReactDoctorInspectOptions): ResolvedInspectOptions =>
  resolveInspectOptions({
    inputOptions,
    userConfig: null,
    environment: {
      isCiOrCodingAgentEnvironment: false,
      isNonInteractiveEnvironment: true,
    },
  });

const buildInput = (
  inputOptions: ReactDoctorInspectOptions,
  overrides: Partial<ResolveBaselineComparisonInput> = {},
): ResolveBaselineComparisonInput => ({
  directory: "/repo",
  options: resolveOptions(inputOptions),
  userConfig: null,
  configSourceDirectory: null,
  headProjectInfo: projectInfo,
  headDiagnostics: [diagnostic("src/app.tsx", 3)],
  headAnalyzedFiles: ["src/app.tsx"],
  didLintFail: false,
  lintPartialFailures: [],
  resolvedNodeBinaryPath: "/node",
  deadlineEpochMs: null,
  oxlintRuntime: {
    concurrency: 2,
    spawnSlots: createOxlintSpawnSlots(2),
  },
  silentConsole: makeNoopConsole(),
  ...overrides,
});

describe("resolveBaselineComparison", () => {
  afterEach(() => {
    mockedMaterializeBaselineFiles.mockReset();
  });

  it("filters diagnostics by changed lines without entering baseline materialization", async () => {
    const diagnostics = [diagnostic("src/app.tsx", 3), diagnostic("/repo/src/app.tsx", 8)];
    const result = await resolveBaselineComparison(
      buildInput(
        {
          includePaths: ["src/app.tsx"],
          changedLineRanges: [{ file: "src/app.tsx", ranges: [[7, 9]] }],
        },
        { headDiagnostics: diagnostics },
      ),
    );

    expect(result).toEqual({
      displayDiagnostics: [diagnostics[1]],
      baselineDelta: undefined,
    });
    expect(mockedMaterializeBaselineFiles).not.toHaveBeenCalled();
  });

  it("preserves the head diagnostic identity when its lint coverage is incomplete", async () => {
    const diagnostics = [diagnostic("src/app.tsx", 3)];
    const result = await resolveBaselineComparison(
      buildInput(
        {
          includePaths: ["src/app.tsx"],
          baseline: { ref: "origin/main" },
        },
        {
          headDiagnostics: diagnostics,
          lintPartialFailures: ["1 file(s) skipped — max scan duration reached"],
        },
      ),
    );

    expect(result.displayDiagnostics).toBe(diagnostics);
    expect(result.baselineDelta).toBeUndefined();
    expect(mockedMaterializeBaselineFiles).not.toHaveBeenCalled();
  });

  it("preserves materialization inputs and removes the allocated temp directory on null", async () => {
    const baseFiles = ["src/base.tsx"];
    const headFiles = ["src/head.tsx"];
    const includePaths = ["src/app.tsx"];
    const baseline = { ref: "origin/main", baseFiles, headFiles };
    mockedMaterializeBaselineFiles.mockResolvedValue(null);

    const result = await resolveBaselineComparison(
      buildInput({
        includePaths,
        baseline,
      }),
    );

    expect(result.baselineDelta).toBeUndefined();
    expect(mockedMaterializeBaselineFiles).toHaveBeenCalledTimes(1);
    const materializationInput = mockedMaterializeBaselineFiles.mock.calls[0][0];
    expect(materializationInput).toMatchObject({
      directory: "/repo",
      ref: baseline.ref,
    });
    expect(materializationInput.files).toBe(includePaths);
    expect(materializationInput.baseFiles).toBe(baseFiles);
    expect(materializationInput.headFiles).toBe(headFiles);
    expect(path.dirname(materializationInput.tempDirectory)).toBe(tmpdir());
    expect(path.basename(materializationInput.tempDirectory)).toMatch(
      new RegExp(`^${BASELINE_FILES_TEMP_DIR_PREFIX}`),
    );
    expect(fs.existsSync(materializationInput.tempDirectory)).toBe(false);
  });

  it("cleans an incomplete snapshot through its owned cleanup callback", async () => {
    const cleanup = vi.fn();
    mockedMaterializeBaselineFiles.mockImplementation(async (input) => {
      cleanup.mockImplementation(() => {
        fs.rmSync(input.tempDirectory, { recursive: true, force: true });
      });
      return {
        tempDirectory: input.tempDirectory,
        materializedFiles: [],
        unmaterializedFiles: ["src/app.tsx"],
        cleanup,
        baseFiles: ["src/app.tsx"],
        headFiles: ["src/app.tsx"],
        isComplete: false,
        untrackedFiles: [],
      };
    });

    const result = await resolveBaselineComparison(
      buildInput({
        includePaths: ["src/app.tsx"],
        baseline: { ref: "origin/main" },
      }),
    );

    expect(result.baselineDelta).toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const materializationInput = mockedMaterializeBaselineFiles.mock.calls[0][0];
    expect(fs.existsSync(materializationInput.tempDirectory)).toBe(false);
  });

  it("returns the diagnostic delta and cleans the snapshot after a successful base scan", async () => {
    const cleanup = vi.fn();
    mockedMaterializeBaselineFiles.mockImplementation(async (input) => {
      cleanup.mockImplementation(() => {
        fs.rmSync(input.tempDirectory, { recursive: true, force: true });
      });
      return {
        tempDirectory: input.tempDirectory,
        materializedFiles: ["src/app.tsx"],
        unmaterializedFiles: [],
        cleanup,
        baseFiles: ["src/app.tsx"],
        headFiles: ["src/app.tsx"],
        isComplete: true,
        untrackedFiles: [],
      };
    });
    const diagnostics = [diagnostic("src/app.tsx", 3)];

    const result = await resolveBaselineComparison(
      buildInput(
        {
          includePaths: ["src/app.tsx"],
          baseline: { ref: "origin/main" },
          supplyChain: false,
        },
        {
          headDiagnostics: diagnostics,
          resolvedNodeBinaryPath: null,
        },
      ),
    );

    expect(result).toEqual({
      displayDiagnostics: diagnostics,
      baselineDelta: {
        baseRef: "origin/main",
        fixedCount: 0,
        baseTotalCount: 0,
        crossFileMatchCount: 0,
      },
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    const materializationInput = mockedMaterializeBaselineFiles.mock.calls[0][0];
    expect(fs.existsSync(materializationInput.tempDirectory)).toBe(false);
  });

  it("removes the allocated temp directory and rethrows the original materialization error", async () => {
    const materializationError = new Error("materialization failed");
    mockedMaterializeBaselineFiles.mockRejectedValue(materializationError);
    const input = buildInput({
      includePaths: ["src/app.tsx"],
      baseline: { ref: "origin/main" },
    });

    await expect(resolveBaselineComparison(input)).rejects.toBe(materializationError);

    const materializationInput = mockedMaterializeBaselineFiles.mock.calls[0][0];
    expect(fs.existsSync(materializationInput.tempDirectory)).toBe(false);
  });
});
