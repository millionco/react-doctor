import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { InspectResult } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import type { InspectFlags } from "../src/cli/utils/inspect-flags.js";
import { buildDiagnostic, buildTestProject } from "./regressions/_helpers.js";

const mockState = vi.hoisted(() => ({
  projectDirectories: [] as string[],
  result: undefined as InspectResult | undefined,
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
      resolvedDirectory: requestedDirectory,
      requestedDirectory,
      userConfig: null,
      configSourceDirectory: null,
      didRedirectViaRootDir: false,
    })),
    filterDiagnosticsForSurface: vi.fn((diagnostics) => diagnostics),
  };
});

vi.mock("../src/inspect.js", () => ({
  inspect: vi.fn(async (): Promise<InspectResult> => {
    if (mockState.result === undefined) throw new Error("mockState.result not set");
    return mockState.result;
  }),
}));

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

  it("still exits 1 when a complete scan has a blocking finding", async () => {
    await runInspectAction({ diagnostics: [buildDiagnostic({ severity: "error" })] });
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
