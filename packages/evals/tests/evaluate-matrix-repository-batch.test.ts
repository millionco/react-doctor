import { Daytona, Sandbox } from "@daytona/sdk";
import { describe, expect, it, vi } from "vite-plus/test";

import type { MatrixEvaluationLane } from "../src/build-matrix-evaluation-plan.js";
import {
  EVALUATION_CONFIG_CONTRACT,
  RESOLVE_MATRIX_TARGET_REPOSITORY_REF_COMMAND,
  SCAN_COMMAND,
  SETUP_MATRIX_TARGET_REPOSITORY_COMMAND,
} from "../src/constants.js";
import { evaluateMatrixRepositoryBatch } from "../src/evaluate-matrix-repository-batch.js";

const MATRIX_SCAN_DELAY_MS = 5;
const CONTROL_PLANE_TEST_TIMEOUT_MS = 5;

const buildLane = (id: string, index: number): MatrixEvaluationLane => ({
  id,
  kind: id === "matrix-base" ? "base" : "treatment",
  reactDoctorRepository: "https://github.com/example/react-doctor.git",
  reactDoctorRef: String(index + 1).repeat(40),
  ruleKeys: [`react-doctor/rule-${index}`],
  reactDoctorWorkDirectory: `/workspace/react-doctor-matrix/${id}`,
  provenancePath: `/workspace/react-doctor-matrix-provenance/${id}.json`,
  targetWorkDirectory: `/workspace/target-matrix-lanes/${id}`,
  reportPath: `/tmp/react-doctor-matrix-reports/${id}.json`,
});

const buildReport = (directory: string) => ({
  schemaVersion: 3,
  version: "0.9.2",
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

describe("evaluateMatrixRepositoryBatch", () => {
  it("runs treatments together before the base and isolates one failed treatment", async () => {
    const lanes = [buildLane("pr-1", 1), buildLane("pr-2", 2), buildLane("matrix-base", 0)];
    let activeScanCount = 0;
    let maximumActiveScanCount = 0;
    const activeScanLaneIds = new Set<string>();
    const concurrentScanLaneSets: string[][] = [];
    const scanEnvironments: Array<Record<string, string>> = [];
    const executeCommand = vi.fn(
      async (command: string, _cwd: string | undefined, environment: Record<string, string>) => {
        if (command === RESOLVE_MATRIX_TARGET_REPOSITORY_REF_COMMAND) {
          return { exitCode: 0, result: "f".repeat(40) };
        }
        if (command === SCAN_COMMAND) {
          scanEnvironments.push(environment);
          const laneId = environment.REACT_DOCTOR_WORK_DIRECTORY.split("/").at(-1);
          if (!laneId) throw new Error("scan lane is missing");
          activeScanLaneIds.add(laneId);
          activeScanCount += 1;
          maximumActiveScanCount = Math.max(maximumActiveScanCount, activeScanCount);
          if (activeScanLaneIds.size > 1) {
            concurrentScanLaneSets.push([...activeScanLaneIds].sort());
          }
          await new Promise((resolve) => setTimeout(resolve, MATRIX_SCAN_DELAY_MS));
          activeScanLaneIds.delete(laneId);
          activeScanCount -= 1;
          if (environment.REACT_DOCTOR_WORK_DIRECTORY.endsWith("/pr-2")) {
            throw new Error("pr-2 failed");
          }
        }
        return { exitCode: 0, result: "" };
      },
    );
    const downloadFile = vi.fn(async (filePath: string) => {
      const provenanceLane = lanes.find((lane) => lane.provenancePath === filePath);
      if (provenanceLane) {
        return Buffer.from(
          JSON.stringify({
            reactDoctorRepository: provenanceLane.reactDoctorRepository,
            reactDoctorCommit: provenanceLane.reactDoctorRef,
            configContract: EVALUATION_CONFIG_CONTRACT,
            ruleSetHash: "a".repeat(64),
            ruleKeys: provenanceLane.ruleKeys,
          }),
        );
      }
      const reportLane = lanes.find((lane) => lane.reportPath === filePath);
      return Buffer.from(
        JSON.stringify(buildReport(reportLane?.targetWorkDirectory ?? "/missing")),
      );
    });
    const sandbox = Object.create(Sandbox.prototype);
    Object.defineProperties(sandbox, {
      id: { value: "sandbox-id" },
      process: { value: { executeCommand } },
      fs: { value: { downloadFile } },
    });
    const daytona = new Daytona({ apiKey: "test" });
    Object.defineProperty(daytona, "delete", { value: vi.fn(async () => undefined) });
    const records = new Map<string, unknown>();

    const failures = await evaluateMatrixRepositoryBatch({
      daytona,
      createSandbox: async () => sandbox,
      repositoryGroups: [
        {
          org: "example",
          name: "repository",
          ref: "e".repeat(40),
          rootDirectories: ["."],
        },
      ],
      lanes,
      waveWidth: 2,
      evaluationDeadlineMilliseconds: globalThis.performance.now() + 60_000,
      evaluatorSourceHash: "b".repeat(64),
      onLaneRecord: async (laneId, record) => {
        records.set(laneId, record);
      },
    });

    expect(maximumActiveScanCount).toBe(2);
    expect(concurrentScanLaneSets).toContainEqual(["pr-1", "pr-2"]);
    expect(concurrentScanLaneSets.some((laneIds) => laneIds.includes("matrix-base"))).toBe(false);
    expect(
      executeCommand.mock.calls.filter(
        ([command]) => command === SETUP_MATRIX_TARGET_REPOSITORY_COMMAND,
      ),
    ).toHaveLength(1);
    expect(scanEnvironments.map((environment) => environment.TARGET_CHECKOUT_DIRECTORY)).toEqual([
      lanes[0].targetWorkDirectory,
      lanes[1].targetWorkDirectory,
      lanes[2].targetWorkDirectory,
    ]);
    expect([...records.keys()]).toEqual(["pr-1", "matrix-base"]);
    expect(failures).toEqual([
      {
        laneId: "pr-2",
        record: {
          schemaVersion: 1,
          repository: {
            org: "example",
            name: "repository",
            ref: "f".repeat(40),
            rootDir: ".",
          },
          error: "pr-2 failed",
        },
      },
    ]);
  });

  it("does not hang when failed sandbox creation recovery never settles", async () => {
    const lane = buildLane("pr-1", 0);
    const daytona = new Daytona({ apiKey: "test" });
    Object.defineProperty(daytona, "get", {
      value: vi.fn(() => new Promise<never>(() => undefined)),
    });

    const failures = await evaluateMatrixRepositoryBatch({
      daytona,
      createSandbox: async () => {
        throw new Error("create response lost");
      },
      repositoryGroups: [
        {
          org: "example",
          name: "repository",
          ref: "e".repeat(40),
          rootDirectories: ["."],
        },
      ],
      lanes: [lane],
      waveWidth: 1,
      evaluationDeadlineMilliseconds: globalThis.performance.now() + CONTROL_PLANE_TEST_TIMEOUT_MS,
      evaluatorSourceHash: "b".repeat(64),
      onLaneRecord: vi.fn(async () => undefined),
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].record.error).toBe("create response lost");
  });
});
