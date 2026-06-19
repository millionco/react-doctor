import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, defineConfig } from "deslop-js";
import type { ScanResult } from "deslop-js";
import {
  EXIT_CODE_INVALID_ROOT,
  EXIT_CODE_ISSUES_FOUND,
  EXIT_CODE_RUNTIME_ERROR,
  EXIT_CODE_SUCCESS,
} from "../src/constants.js";
import { hasCircularIssues, hasUnusedIssues } from "../src/format-result.js";
import { resolveAnalyzeExitCode, runAnalyze } from "../src/run-analyze.js";
import { validateRootDirectory } from "../src/utils/validate-root-directory.js";
import { FIXTURES_DIR } from "./helpers/fixtures-dir.js";

const testDirectory = resolve(fileURLToPath(import.meta.url), "..");
const packageDirectory = resolve(testDirectory, "..");
const simpleAppFixture = resolve(FIXTURES_DIR, "simple-app");
const cycleSimpleFixture = resolve(FIXTURES_DIR, "cycle-simple");
const cliEntryPath = resolve(packageDirectory, "src/cli.ts");

const emptyScanResult: ScanResult = {
  unusedFiles: [],
  unusedExports: [],
  unusedDependencies: [],
  circularDependencies: [],
  unusedTypes: [],
  misclassifiedDependencies: [],
  unusedEnumMembers: [],
  unusedClassMembers: [],
  redundantAliases: [],
  duplicateExports: [],
  duplicateImports: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  duplicateTypeDefinitions: [],
  duplicateInlineTypes: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstants: [],
  analysisErrors: [],
  totalFiles: 0,
  totalExports: 0,
  analysisTimeMs: 0,
};

const createCaptureOutput = () => {
  const capturedText = { stdout: "", stderr: "" };

  const captureStdout = new Writable({
    write(chunk, _encoding, callback) {
      capturedText.stdout += chunk.toString();
      callback();
    },
  });
  const captureStderr = new Writable({
    write(chunk, _encoding, callback) {
      capturedText.stderr += chunk.toString();
      callback();
    },
  });

  return {
    capturedText,
    output: { stdout: captureStdout, stderr: captureStderr },
  };
};

const runCli = (
  argumentsList: string[],
  workingDirectory: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntryPath, ...argumentsList], {
      cwd: workingDirectory,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      resolvePromise({
        exitCode: exitCode ?? EXIT_CODE_RUNTIME_ERROR,
        stdout,
        stderr,
      });
    });
  });

describe("validateRootDirectory", () => {
  it("should reject a path that does not exist", () => {
    const validation = validateRootDirectory("/nonexistent-deslop-root-xyz");
    assert.equal(validation.isValid, false);
    assert.match(validation.errorMessage ?? "", /does not exist/);
  });

  it("should accept the simple-app fixture", () => {
    const validation = validateRootDirectory(simpleAppFixture);
    assert.equal(validation.isValid, true);
    assert.equal(validation.missingPackageJson, false);
  });
});

describe("resolveAnalyzeExitCode", () => {
  it("should return success when no fail flags are set", () => {
    const exitCode = resolveAnalyzeExitCode(
      { ...emptyScanResult, unusedFiles: [{ path: "orphan.ts" }] },
      { failOnIssues: false, failOnCycles: false },
    );
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
  });

  it("should fail on unused issues only when --fail-on-issues is set", () => {
    const exitCode = resolveAnalyzeExitCode(
      {
        ...emptyScanResult,
        unusedFiles: [{ path: "orphan.ts" }],
        circularDependencies: [{ files: ["a.ts", "b.ts"] }],
      },
      { failOnIssues: true, failOnCycles: false },
    );
    assert.equal(exitCode, EXIT_CODE_ISSUES_FOUND);
  });

  it("should not fail on cycles when only --fail-on-issues is set", () => {
    const exitCode = resolveAnalyzeExitCode(
      { ...emptyScanResult, circularDependencies: [{ files: ["a.ts", "b.ts"] }] },
      { failOnIssues: true, failOnCycles: false },
    );
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
  });

  it("should fail on cycles when --fail-on-cycles is set", () => {
    const exitCode = resolveAnalyzeExitCode(
      { ...emptyScanResult, circularDependencies: [{ files: ["a.ts", "b.ts"] }] },
      { failOnIssues: false, failOnCycles: true },
    );
    assert.equal(exitCode, EXIT_CODE_ISSUES_FOUND);
  });
});

describe("hasUnusedIssues / hasCircularIssues", () => {
  it("should treat circular imports separately from unused code", () => {
    const result: ScanResult = {
      ...emptyScanResult,
      circularDependencies: [{ files: ["a.ts", "b.ts"] }],
    };
    assert.equal(hasUnusedIssues(result), false);
    assert.equal(hasCircularIssues(result), true);
  });
});

describe("runAnalyze", () => {
  it("should return invalid root exit code for missing directories", async () => {
    const capture = createCaptureOutput();
    const exitCode = await runAnalyze(
      {
        root: "/nonexistent-deslop-root-xyz",
        reportTypes: false,
        includeEntryExports: false,
        json: false,
        failOnIssues: false,
        failOnCycles: false,
      },
      capture.output,
    );
    assert.equal(exitCode, EXIT_CODE_INVALID_ROOT);
    assert.match(capture.capturedText.stderr, /does not exist/);
  });

  it("should return success for simple-app without fail flags", async () => {
    const scanResult = await analyze(defineConfig({ rootDir: simpleAppFixture }));
    assert.equal(hasUnusedIssues(scanResult), true);

    const capture = createCaptureOutput();
    const exitCode = await runAnalyze(
      {
        root: simpleAppFixture,
        reportTypes: false,
        includeEntryExports: false,
        json: true,
        failOnIssues: false,
        failOnCycles: false,
      },
      capture.output,
    );
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.match(capture.capturedText.stdout, /"unusedFiles"/);
  });

  it("should exit 1 with --fail-on-issues when unused code exists", async () => {
    const capture = createCaptureOutput();
    const exitCode = await runAnalyze(
      {
        root: simpleAppFixture,
        reportTypes: false,
        includeEntryExports: false,
        json: true,
        failOnIssues: true,
        failOnCycles: false,
      },
      capture.output,
    );
    assert.equal(exitCode, EXIT_CODE_ISSUES_FOUND);
  });

  it("should not exit 1 with --fail-on-issues for cycle-only fixtures", async () => {
    const capture = createCaptureOutput();
    const exitCode = await runAnalyze(
      {
        root: cycleSimpleFixture,
        reportTypes: false,
        includeEntryExports: false,
        json: true,
        failOnIssues: true,
        failOnCycles: false,
      },
      capture.output,
    );
    assert.equal(exitCode, EXIT_CODE_SUCCESS);
    assert.equal(JSON.parse(capture.capturedText.stdout).circularDependencies.length, 1);
  });

  it("should exit 1 with --fail-on-cycles for cycle fixtures", async () => {
    const capture = createCaptureOutput();
    const exitCode = await runAnalyze(
      {
        root: cycleSimpleFixture,
        reportTypes: false,
        includeEntryExports: false,
        json: true,
        failOnIssues: false,
        failOnCycles: true,
      },
      capture.output,
    );
    assert.equal(exitCode, EXIT_CODE_ISSUES_FOUND);
  });
});

describe("cli process", () => {
  it("should reject an invalid root path", async () => {
    const outcome = await runCli(["/nonexistent-deslop-root-xyz"], packageDirectory);
    assert.equal(outcome.exitCode, EXIT_CODE_INVALID_ROOT);
    assert.match(outcome.stderr, /does not exist/);
  });

  it("should print version", async () => {
    const outcome = await runCli(["--version"], packageDirectory);
    assert.equal(outcome.exitCode, EXIT_CODE_SUCCESS);
    assert.match(outcome.stdout, /^\d+\.\d+\.\d+\n$/);
  });

  it("should exit 1 with --fail-on-issues for projects with unused code", async () => {
    const outcome = await runCli(
      [simpleAppFixture, "--fail-on-issues", "--json"],
      packageDirectory,
    );
    assert.equal(outcome.exitCode, EXIT_CODE_ISSUES_FOUND);
  });
});
