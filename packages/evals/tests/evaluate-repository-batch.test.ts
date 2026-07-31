import { Daytona, Sandbox } from "@daytona/sdk";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  BASE_REACT_DOCTOR_WORK_DIRECTORY,
  BASE_SANDBOX_REPORT_PATH,
  BASE_TARGET_WORK_DIRECTORY,
  EVALUATION_CONFIG_CONTRACT,
  MILLISECONDS_PER_SECOND,
  PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS,
  REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  SANDBOX_REPORT_PATH,
  SCAN_COMMAND,
  TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  TREATMENT_REACT_DOCTOR_WORK_DIRECTORY,
  TREATMENT_SANDBOX_REPORT_PATH,
  TREATMENT_TARGET_WORK_DIRECTORY,
} from "../src/constants.js";
import { evaluateRepositoryBatch } from "../src/evaluate-repository-batch.js";

const PAIRED_SCAN_DELAY_MS = 5;

const buildReport = (directory = "/workspace/target") => ({
  schemaVersion: 3,
  version: "0.8.1",
  ok: true,
  directory,
  mode: "full",
  diff: null,
  projects: [
    {
      directory,
      packageRoot: directory,
      framework: "nextjs",
      project: {},
      diagnostics: [],
      score: null,
      skippedChecks: [],
      analyzedFiles: [],
      analyzedFileCount: 0,
      complete: true,
      elapsedMilliseconds: 1,
    },
  ],
  diagnostics: [],
  summary: {
    errorCount: 0,
    warningCount: 0,
    affectedFileCount: 0,
    totalDiagnosticCount: 0,
    score: null,
    scoreLabel: null,
  },
  elapsedMilliseconds: 1,
  error: null,
});

describe("evaluateRepositoryBatch", () => {
  it("downloads the report file instead of parsing truncated command output", async () => {
    const report = buildReport();
    const evaluationProvenance = {
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorCommit: "c".repeat(40),
      configContract: EVALUATION_CONFIG_CONTRACT,
      ruleSetHash: "d".repeat(64),
      ruleKeys: [],
    };
    const executeCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, result: "" })
      .mockResolvedValueOnce({ exitCode: 0, result: "a".repeat(40) })
      .mockResolvedValueOnce({ exitCode: 0, result: '{"ok":true' });
    const downloadFile = vi.fn(async (filePath: string) =>
      Buffer.from(
        JSON.stringify(
          filePath === REACT_DOCTOR_EVALUATION_PROVENANCE_PATH ? evaluationProvenance : report,
        ),
      ),
    );
    const sandbox = Object.create(Sandbox.prototype);
    Object.defineProperties(sandbox, {
      id: { value: "sandbox-id" },
      process: { value: { executeCommand } },
      fs: { value: { downloadFile } },
    });
    const daytona = new Daytona({ apiKey: "test" });
    Object.defineProperty(daytona, "delete", { value: vi.fn(async () => undefined) });
    const records: unknown[] = [];

    const failedRecords = await evaluateRepositoryBatch({
      daytona,
      createSandbox: async () => sandbox,
      repositoryGroups: [
        {
          org: "example",
          name: "repository",
          ref: "b".repeat(40),
          rootDirectories: ["."],
        },
      ],
      evaluationDeadlineMilliseconds: globalThis.performance.now() + 60_000,
      evaluatorSourceHash: "e".repeat(64),
      onRecord: async (record) => {
        records.push(record);
      },
    });

    expect(failedRecords).toEqual([]);
    expect(downloadFile).toHaveBeenCalledWith(SANDBOX_REPORT_PATH, expect.any(Number));
    expect(downloadFile).not.toHaveBeenCalledWith(
      BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
      expect.any(Number),
    );
    expect(records).toEqual([
      {
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "repository",
          ref: "a".repeat(40),
          rootDir: ".",
        },
        evaluation: {
          ...evaluationProvenance,
          evaluatorSourceHash: "e".repeat(64),
        },
        report,
      },
    ]);
    expect(downloadFile).toHaveBeenCalledWith(
      REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
      expect.any(Number),
    );
    expect(downloadFile).toHaveBeenCalledWith(SANDBOX_REPORT_PATH, expect.any(Number));
  });

  it.each([
    ["parallel", true, 2],
    ["sequential", false, 1],
  ])(
    "runs paired scans %s with isolated detector, target, and report paths",
    async (_executionName, runScansInParallel, expectedMaximumActiveScans) => {
      const baselineProvenance = {
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorCommit: "a".repeat(40),
        configContract: EVALUATION_CONFIG_CONTRACT,
        ruleSetHash: "b".repeat(64),
        ruleKeys: [],
      };
      const treatmentProvenance = {
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorCommit: "c".repeat(40),
        configContract: EVALUATION_CONFIG_CONTRACT,
        ruleSetHash: "d".repeat(64),
        ruleKeys: ["react-doctor/selected-rule"],
      };
      let activeScanCount = 0;
      let maximumActiveScanCount = 0;
      const scanEnvironments: Array<Record<string, string>> = [];
      const executeCommand = vi.fn(
        async (
          command: string,
          _cwd: string | undefined,
          environment: Record<string, string>,
          _timeoutSeconds: number,
        ) => {
          if (command !== SCAN_COMMAND) {
            return {
              exitCode: 0,
              result: command.includes("rev-parse") ? "e".repeat(40) : "",
            };
          }
          scanEnvironments.push(environment);
          activeScanCount += 1;
          maximumActiveScanCount = Math.max(maximumActiveScanCount, activeScanCount);
          await new Promise((resolve) => setTimeout(resolve, PAIRED_SCAN_DELAY_MS));
          activeScanCount -= 1;
          return { exitCode: 0, result: "" };
        },
      );
      const downloadFile = vi.fn(async (filePath: string) => {
        if (filePath === BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH) {
          return Buffer.from(JSON.stringify(baselineProvenance));
        }
        if (filePath === TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH) {
          return Buffer.from(JSON.stringify(treatmentProvenance));
        }
        if (filePath === BASE_SANDBOX_REPORT_PATH) {
          return Buffer.from(JSON.stringify(buildReport(BASE_TARGET_WORK_DIRECTORY)));
        }
        return Buffer.from(JSON.stringify(buildReport(TREATMENT_TARGET_WORK_DIRECTORY)));
      });
      const sandbox = Object.create(Sandbox.prototype);
      Object.defineProperties(sandbox, {
        id: { value: "sandbox-id" },
        process: { value: { executeCommand } },
        fs: { value: { downloadFile } },
      });
      const daytona = new Daytona({ apiKey: "test" });
      Object.defineProperty(daytona, "delete", { value: vi.fn(async () => undefined) });
      const baselineRecords: unknown[] = [];
      const treatmentRecords: unknown[] = [];

      const failedRecords = await evaluateRepositoryBatch({
        daytona,
        createSandbox: async () => sandbox,
        repositoryGroups: [
          {
            org: "example",
            name: "repository",
            ref: "f".repeat(40),
            rootDirectories: ["."],
          },
        ],
        evaluationDeadlineMilliseconds:
          globalThis.performance.now() +
          (PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS + 1) * MILLISECONDS_PER_SECOND,
        evaluatorSourceHash: "f".repeat(64),
        onRecord: async (record) => {
          treatmentRecords.push(record);
        },
        paired: {
          runScansInParallel,
          onPairedRecords: async ({ baseline, treatment }) => {
            baselineRecords.push(baseline);
            treatmentRecords.push(treatment);
          },
        },
      });

      expect(failedRecords).toEqual([]);
      expect(maximumActiveScanCount).toBe(expectedMaximumActiveScans);
      expect(scanEnvironments).toHaveLength(2);
      expect(
        scanEnvironments.map((environment) => environment.REACT_DOCTOR_WORK_DIRECTORY),
      ).toEqual([BASE_REACT_DOCTOR_WORK_DIRECTORY, TREATMENT_REACT_DOCTOR_WORK_DIRECTORY]);
      expect(
        executeCommand.mock.calls
          .filter(([command]) => command === SCAN_COMMAND)
          .map(([, , , timeoutSeconds]) => timeoutSeconds),
      ).toEqual([PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS, PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS]);
      expect(scanEnvironments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            REACT_DOCTOR_WORK_DIRECTORY: BASE_REACT_DOCTOR_WORK_DIRECTORY,
            REACT_DOCTOR_RULE_KEYS: "[]",
            TARGET_CHECKOUT_DIRECTORY: BASE_TARGET_WORK_DIRECTORY,
            SANDBOX_REPORT_PATH: BASE_SANDBOX_REPORT_PATH,
          }),
          expect.objectContaining({
            REACT_DOCTOR_WORK_DIRECTORY: TREATMENT_REACT_DOCTOR_WORK_DIRECTORY,
            REACT_DOCTOR_RULE_KEYS: JSON.stringify(["react-doctor/selected-rule"]),
            TARGET_CHECKOUT_DIRECTORY: TREATMENT_TARGET_WORK_DIRECTORY,
            SANDBOX_REPORT_PATH: TREATMENT_SANDBOX_REPORT_PATH,
          }),
        ]),
      );
      expect(baselineRecords).toHaveLength(1);
      expect(treatmentRecords).toHaveLength(1);
      expect(baselineRecords[0]).toEqual(
        expect.objectContaining({
          evaluation: expect.objectContaining({ reactDoctorCommit: "a".repeat(40) }),
          report: expect.objectContaining({ directory: BASE_TARGET_WORK_DIRECTORY }),
        }),
      );
      expect(treatmentRecords[0]).toEqual(
        expect.objectContaining({
          evaluation: expect.objectContaining({ reactDoctorCommit: "c".repeat(40) }),
          report: expect.objectContaining({ directory: TREATMENT_TARGET_WORK_DIRECTORY }),
        }),
      );
    },
  );

  it("waits for both parallel scans before retrying without a partial baseline", async () => {
    const baselineProvenance = {
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorCommit: "a".repeat(40),
      configContract: EVALUATION_CONFIG_CONTRACT,
      ruleSetHash: "b".repeat(64),
      ruleKeys: [],
    };
    const treatmentProvenance = {
      ...baselineProvenance,
      reactDoctorCommit: "c".repeat(40),
      ruleSetHash: "d".repeat(64),
    };
    let didBaselineScanSettle = false;
    const executeCommand = vi.fn(
      async (command: string, _cwd: string | undefined, environment: Record<string, string>) => {
        if (command.includes("rev-parse")) return { exitCode: 0, result: "e".repeat(40) };
        if (command === SCAN_COMMAND) {
          if (environment.REACT_DOCTOR_WORK_DIRECTORY === BASE_REACT_DOCTOR_WORK_DIRECTORY) {
            await new Promise((resolve) => setTimeout(resolve, PAIRED_SCAN_DELAY_MS));
            didBaselineScanSettle = true;
          } else {
            throw new Error("treatment failed");
          }
        }
        return { exitCode: 0, result: "" };
      },
    );
    const downloadFile = vi.fn(async (filePath: string) => {
      if (filePath === BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH) {
        return Buffer.from(JSON.stringify(baselineProvenance));
      }
      if (filePath === TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH) {
        return Buffer.from(JSON.stringify(treatmentProvenance));
      }
      return Buffer.from(JSON.stringify(buildReport(BASE_TARGET_WORK_DIRECTORY)));
    });
    const sandbox = Object.create(Sandbox.prototype);
    Object.defineProperties(sandbox, {
      id: { value: "sandbox-id" },
      process: { value: { executeCommand } },
      fs: { value: { downloadFile } },
    });
    const daytona = new Daytona({ apiKey: "test" });
    Object.defineProperty(daytona, "delete", {
      value: vi.fn(async () => {
        expect(didBaselineScanSettle).toBe(true);
      }),
    });
    const onRecord = vi.fn(async () => undefined);
    const onPairedRecords = vi.fn(async () => undefined);

    const failedRecords = await evaluateRepositoryBatch({
      daytona,
      createSandbox: async () => sandbox,
      repositoryGroups: [
        {
          org: "example",
          name: "repository",
          ref: "f".repeat(40),
          rootDirectories: ["."],
        },
      ],
      evaluationDeadlineMilliseconds: globalThis.performance.now() + 60_000,
      evaluatorSourceHash: "f".repeat(64),
      onRecord,
      paired: { runScansInParallel: true, onPairedRecords },
    });

    expect(executeCommand.mock.calls.filter(([command]) => command === SCAN_COMMAND)).toHaveLength(
      2,
    );
    expect(didBaselineScanSettle).toBe(true);
    expect(onPairedRecords).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
    expect(failedRecords).toEqual([
      {
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "repository",
          ref: "e".repeat(40),
          rootDir: ".",
        },
        error: "treatment failed",
      },
    ]);
  });

  it("propagates paired sink failures instead of returning a retryable record", async () => {
    const baselineProvenance = {
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorCommit: "a".repeat(40),
      configContract: EVALUATION_CONFIG_CONTRACT,
      ruleSetHash: "b".repeat(64),
      ruleKeys: [],
    };
    const treatmentProvenance = {
      ...baselineProvenance,
      reactDoctorCommit: "c".repeat(40),
      ruleSetHash: "d".repeat(64),
    };
    const executeCommand = vi.fn(async (command: string) => ({
      exitCode: 0,
      result: command.includes("rev-parse") ? "e".repeat(40) : "",
    }));
    const downloadFile = vi.fn(async (filePath: string) => {
      if (filePath === BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH) {
        return Buffer.from(JSON.stringify(baselineProvenance));
      }
      if (filePath === TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH) {
        return Buffer.from(JSON.stringify(treatmentProvenance));
      }
      const reportDirectory =
        filePath === BASE_SANDBOX_REPORT_PATH
          ? BASE_TARGET_WORK_DIRECTORY
          : TREATMENT_TARGET_WORK_DIRECTORY;
      return Buffer.from(JSON.stringify(buildReport(reportDirectory)));
    });
    const sandbox = Object.create(Sandbox.prototype);
    Object.defineProperties(sandbox, {
      id: { value: "sandbox-id" },
      process: { value: { executeCommand } },
      fs: { value: { downloadFile } },
    });
    const daytona = new Daytona({ apiKey: "test" });
    const deleteSandbox = vi.fn(async () => undefined);
    Object.defineProperty(daytona, "delete", { value: deleteSandbox });
    const onPairedRecords = vi.fn(async () => {
      throw new Error("artifact sink failed");
    });

    await expect(
      evaluateRepositoryBatch({
        daytona,
        createSandbox: async () => sandbox,
        repositoryGroups: [
          {
            org: "example",
            name: "repository",
            ref: "f".repeat(40),
            rootDirectories: ["."],
          },
        ],
        evaluationDeadlineMilliseconds: globalThis.performance.now() + 60_000,
        evaluatorSourceHash: "f".repeat(64),
        onRecord: vi.fn(async () => undefined),
        paired: { runScansInParallel: true, onPairedRecords },
      }),
    ).rejects.toThrow("artifact sink failed");
    expect(onPairedRecords).toHaveBeenCalledOnce();
    expect(deleteSandbox).toHaveBeenCalledOnce();
  });
});
