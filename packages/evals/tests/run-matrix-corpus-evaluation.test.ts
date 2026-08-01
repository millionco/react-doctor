import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  EVALUATION_CONFIG_CONTRACT,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
} from "../src/constants.js";
import type { CorpusRepository } from "../src/corpus.js";
import type { MatrixEvaluationLane } from "../src/build-matrix-evaluation-plan.js";
import type { CleanupEvaluationSandboxesInput } from "../src/cleanup-evaluation-sandboxes.js";
import type { LoadedMatrixTreatment } from "../src/matrix-treatment-descriptor.js";
import type { MatrixBaselineCacheVerification } from "../src/verify-matrix-baseline-cache.js";

const matrixMocks = vi.hoisted(() => ({
  DaytonaNotFoundError: class extends Error {},
  cleanupEvaluationSandboxes: vi.fn<(input: CleanupEvaluationSandboxesInput) => Promise<void>>(
    async () => undefined,
  ),
  evaluateMatrixRepositoryBatch: vi.fn(),
  loadMatrixTreatments: vi.fn(),
  snapshotCreate: vi.fn(async () => undefined),
  snapshotDeleted: false,
  snapshotDelete: vi.fn(async () => {
    matrixMocks.snapshotDeleted = true;
  }),
  snapshotGet: vi.fn(async () => {
    if (matrixMocks.snapshotDeleted) throw new matrixMocks.DaytonaNotFoundError();
    return { name: "snapshot" };
  }),
  verifyMatrixBaselineCache: vi.fn<() => Promise<MatrixBaselineCacheVerification>>(async () => ({
    hit: false,
    invalid: false,
    reason: "missing",
  })),
}));

const fileSystemMocks = vi.hoisted(() => ({
  baseAbortFailuresRemaining: 0,
  baseFinalizeFailuresRemaining: 0,
  treatmentAbortFailuresRemaining: 0,
  treatmentRenameFailuresRemaining: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rename: async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (
        fileSystemMocks.baseFinalizeFailuresRemaining > 0 &&
        path.basename(String(oldPath)) === "artifact.ndjson"
      ) {
        fileSystemMocks.baseFinalizeFailuresRemaining -= 1;
        throw new Error("injected base finalize failure");
      }
      if (
        fileSystemMocks.treatmentRenameFailuresRemaining > 0 &&
        path.basename(String(oldPath)).startsWith(".partial-pr-1-") &&
        path.basename(String(newPath)) === "pr-1"
      ) {
        fileSystemMocks.treatmentRenameFailuresRemaining -= 1;
        throw new Error("injected treatment rename failure");
      }
      return original.rename(oldPath, newPath);
    },
    rm: async (targetPath: fs.PathLike, options?: fs.RmOptions) => {
      if (
        fileSystemMocks.baseAbortFailuresRemaining > 0 &&
        String(targetPath).includes(".ndjson.partial-")
      ) {
        fileSystemMocks.baseAbortFailuresRemaining -= 1;
        throw new Error("injected base abort failure");
      }
      if (
        fileSystemMocks.treatmentAbortFailuresRemaining > 0 &&
        path.basename(String(targetPath)).startsWith(".partial-pr-1-")
      ) {
        fileSystemMocks.treatmentAbortFailuresRemaining -= 1;
        throw new Error("injected treatment abort failure");
      }
      return original.rm(targetPath, options);
    },
  };
});

vi.mock("@daytona/sdk", () => {
  const image = {
    env: vi.fn(() => image),
    runCommands: vi.fn(() => image),
    workdir: vi.fn(() => image),
  };
  return {
    Daytona: class {
      list = async function* () {};
      snapshot = {
        create: matrixMocks.snapshotCreate,
        delete: matrixMocks.snapshotDelete,
        get: matrixMocks.snapshotGet,
      };
    },
    DaytonaNotFoundError: matrixMocks.DaytonaNotFoundError,
    Image: { base: vi.fn(() => image) },
  };
});

vi.mock("../src/cleanup-evaluation-sandboxes.js", () => ({
  cleanupEvaluationSandboxes: matrixMocks.cleanupEvaluationSandboxes,
}));

vi.mock("../src/evaluate-matrix-repository-batch.js", () => ({
  evaluateMatrixRepositoryBatch: matrixMocks.evaluateMatrixRepositoryBatch,
}));

vi.mock("../src/matrix-treatment-descriptor.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadMatrixTreatments: matrixMocks.loadMatrixTreatments,
}));

vi.mock("../src/verify-matrix-baseline-cache.js", () => ({
  parseMatrixBaselineVerifierOutput: vi.fn(),
  verifyMatrixBaselineCache: matrixMocks.verifyMatrixBaselineCache,
}));

vi.mock("../src/verify-matrix-impact-manifests.js", () => ({
  verifyMatrixImpactManifests: vi.fn(async () => undefined),
}));

vi.mock("../src/utils/get-evaluator-source-hash.js", () => ({
  getEvaluatorSourceHash: () => "6".repeat(64),
}));

import { hashMatrixCorpusProjectSet } from "../src/matrix-treatment-descriptor.js";
import { runMatrixCorpusEvaluation } from "../src/run-matrix-corpus-evaluation.js";

const temporaryDirectories: string[] = [];
const CLEANUP_LONGER_THAN_OLD_LIMIT_MS = 31_000;

const hashContents = (contents: string): string =>
  createHash("sha256").update(contents).digest("hex");

const buildTreatment = ({
  temporaryDirectory,
  id,
  group,
  mode,
}: {
  temporaryDirectory: string;
  id: string;
  group: LoadedMatrixTreatment["descriptor"]["group"];
  mode: "full" | "incremental";
}): LoadedMatrixTreatment => {
  const headCommit = id === "pr-1" ? "b".repeat(40) : "c".repeat(40);
  const ruleKeys = mode === "full" ? [] : ["react-doctor/example"];
  return {
    descriptorPath: path.join(temporaryDirectory, `${id}.json`),
    descriptorSha256: "1".repeat(64),
    descriptorContents: `${JSON.stringify({ id })}\n`,
    impactManifestContents: `${JSON.stringify({ mode })}\n`,
    descriptor: {
      schemaVersion: 1,
      id,
      artifactDirectory: path.join(temporaryDirectory, id),
      reactDoctorRepository: "https://github.com/example/react-doctor.git",
      reactDoctorCommit: headCommit,
      impactManifestPath: path.join(temporaryDirectory, `${id}-impact.json`),
      impactManifestSha256: "2".repeat(64),
      group,
    },
    impactManifest: {
      schemaVersion: 1,
      mode,
      baseCommit: group.baseReactDoctorCommit,
      headCommit,
      changedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
      runtimeChangedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
      impactedRuleKeys: ruleKeys,
      candidateRuleKeys: ruleKeys,
      fallbackReasons: mode === "full" ? ["Full parity required"] : [],
      rules: ruleKeys.map((ruleKey) => ({
        ruleKey,
        baseFingerprint: "8".repeat(64),
        headFingerprint: "9".repeat(64),
      })),
    },
    ruleKeys,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fileSystemMocks.baseAbortFailuresRemaining = 0;
  fileSystemMocks.baseFinalizeFailuresRemaining = 0;
  fileSystemMocks.treatmentAbortFailuresRemaining = 0;
  fileSystemMocks.treatmentRenameFailuresRemaining = 0;
  matrixMocks.snapshotDeleted = false;
  matrixMocks.snapshotDelete.mockImplementation(async () => {
    matrixMocks.snapshotDeleted = true;
  });
  matrixMocks.snapshotGet.mockImplementation(async () => {
    if (matrixMocks.snapshotDeleted) throw new matrixMocks.DaytonaNotFoundError();
    return { name: "snapshot" };
  });
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("runMatrixCorpusEvaluation", () => {
  it("publishes blocked treatments after a full base exhausts retries", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-base-failure-"));
    temporaryDirectories.push(temporaryDirectory);
    const repository: CorpusRepository = {
      org: "example",
      name: "repository",
      ref: "f".repeat(40),
      rootDir: ".",
    };
    const corpusManifestPath = path.join(temporaryDirectory, "corpus.json");
    const corpusContents = `${JSON.stringify([repository])}\n`;
    fs.writeFileSync(corpusManifestPath, corpusContents);
    const group = {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
      baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
      corpusManifestPath,
      corpusManifestSha256: hashContents(corpusContents),
      corpusProjectSetSha256: hashMatrixCorpusProjectSet([repository]),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    };
    const treatments = [
      buildTreatment({ temporaryDirectory, id: "pr-1", group, mode: "full" }),
      buildTreatment({ temporaryDirectory, id: "pr-2", group, mode: "incremental" }),
    ];
    matrixMocks.loadMatrixTreatments.mockResolvedValue(treatments);
    fileSystemMocks.baseAbortFailuresRemaining = 1;
    matrixMocks.evaluateMatrixRepositoryBatch.mockImplementation(
      async ({ lanes, onLaneRecord }) => {
        const failures = [];
        for (const lane of lanes) {
          if (lane.kind === "base") {
            failures.push({
              laneId: lane.id,
              record: { schemaVersion: 1, repository, error: "base retries exhausted" },
            });
            continue;
          }
          await onLaneRecord(lane.id, {
            schemaVersion: 1,
            repository,
            evaluation: {
              reactDoctorRepository: lane.reactDoctorRepository,
              reactDoctorCommit: lane.reactDoctorRef,
              configContract: EVALUATION_CONFIG_CONTRACT,
              ruleSetHash: "7".repeat(64),
              ruleKeys: lane.ruleKeys,
              evaluatorSourceHash: group.evaluatorSourceHash,
            },
            report: { complete: true },
          });
        }
        return failures;
      },
    );

    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 2,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: {
          treatmentDescriptorPaths: treatments.map((treatment) => treatment.descriptorPath),
          waveWidth: 2,
        },
      }),
    ).rejects.toThrow("Matrix evaluation failed for lanes: matrix-base");

    expect(matrixMocks.evaluateMatrixRepositoryBatch).toHaveBeenCalledTimes(4);
    expect(
      matrixMocks.evaluateMatrixRepositoryBatch.mock.calls[0][0].lanes.map(
        (lane: MatrixEvaluationLane) => lane.id,
      ),
    ).toEqual(["pr-1", "pr-2", "matrix-base"]);
    expect(
      matrixMocks.evaluateMatrixRepositoryBatch.mock.calls
        .slice(1)
        .map(([input]) => input.lanes.map((lane: MatrixEvaluationLane) => lane.id)),
    ).toEqual([["matrix-base"], ["matrix-base"], ["matrix-base"]]);
    expect(fs.existsSync(group.baseArtifactPath)).toBe(false);
    expect(fs.existsSync(group.baselineOutputPath)).toBe(false);
    expect(fs.existsSync(group.baselineProvenancePath)).toBe(false);
    for (const treatment of treatments) {
      const artifactDirectory = treatment.descriptor.artifactDirectory;
      const provenance = JSON.parse(
        fs.readFileSync(path.join(artifactDirectory, "provenance.json"), "utf8"),
      );
      expect(provenance).toMatchObject({
        laneId: treatment.descriptor.id,
        status: "blocked",
        expectedProjectCount: 1,
        recordCount: 1,
        failedRecordCount: 0,
      });
      expect(
        fs.readFileSync(path.join(artifactDirectory, "candidate.ndjson"), "utf8").trim(),
      ).not.toBe("");
    }
    expect(fs.readdirSync(temporaryDirectory).some((entry) => entry.includes(".partial-"))).toBe(
      false,
    );
  });

  it.each([
    {
      failureName: "rename and initial abort",
      baseAbortFailures: 1,
      baseFinalizeFailures: 1,
      expectedError: "injected base finalize failure",
    },
    {
      failureName: "post-rename pending cleanup",
      baseAbortFailures: 1,
      baseFinalizeFailures: 0,
      expectedError: "injected base abort failure",
    },
  ])("publishes blocked treatments after base $failureName fails", async (failure) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-base-finalize-"));
    temporaryDirectories.push(temporaryDirectory);
    const repository: CorpusRepository = {
      org: "example",
      name: "repository",
      ref: "f".repeat(40),
      rootDir: ".",
    };
    const corpusManifestPath = path.join(temporaryDirectory, "corpus.json");
    const corpusContents = `${JSON.stringify([repository])}\n`;
    fs.writeFileSync(corpusManifestPath, corpusContents);
    const group = {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
      baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
      corpusManifestPath,
      corpusManifestSha256: hashContents(corpusContents),
      corpusProjectSetSha256: hashMatrixCorpusProjectSet([repository]),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    };
    const treatments = [
      buildTreatment({ temporaryDirectory, id: "pr-1", group, mode: "incremental" }),
      buildTreatment({ temporaryDirectory, id: "pr-2", group, mode: "incremental" }),
    ];
    matrixMocks.loadMatrixTreatments.mockResolvedValue(treatments);
    matrixMocks.evaluateMatrixRepositoryBatch.mockImplementation(
      async ({ lanes, onLaneRecord }) => {
        for (const lane of lanes) {
          await onLaneRecord(lane.id, {
            schemaVersion: 1,
            repository,
            evaluation: {
              reactDoctorRepository: lane.reactDoctorRepository,
              reactDoctorCommit: lane.reactDoctorRef,
              configContract: EVALUATION_CONFIG_CONTRACT,
              ruleSetHash: lane.kind === "base" ? group.baseFullRuleSetHash : "7".repeat(64),
              ruleKeys: lane.ruleKeys,
              evaluatorSourceHash: group.evaluatorSourceHash,
            },
            report: { complete: true },
          });
        }
        return [];
      },
    );
    fileSystemMocks.baseFinalizeFailuresRemaining = failure.baseFinalizeFailures;
    fileSystemMocks.baseAbortFailuresRemaining = failure.baseAbortFailures;

    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 2,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: {
          treatmentDescriptorPaths: treatments.map((treatment) => treatment.descriptorPath),
          waveWidth: 2,
        },
      }),
    ).rejects.toThrow(failure.expectedError);

    for (const treatment of treatments) {
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(treatment.descriptor.artifactDirectory, "provenance.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({ laneId: treatment.descriptor.id, status: "blocked" });
    }
    expect(fs.existsSync(group.baseArtifactPath)).toBe(false);
    expect(fs.readdirSync(temporaryDirectory).some((entry) => entry.includes(".partial-"))).toBe(
      false,
    );
  });

  it("settles sibling treatments after one treatment rename and abort initially fail", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-treatment-finalize-"));
    temporaryDirectories.push(temporaryDirectory);
    const repository: CorpusRepository = {
      org: "example",
      name: "repository",
      ref: "f".repeat(40),
      rootDir: ".",
    };
    const corpusManifestPath = path.join(temporaryDirectory, "corpus.json");
    const corpusContents = `${JSON.stringify([repository])}\n`;
    fs.writeFileSync(corpusManifestPath, corpusContents);
    const group = {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
      baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
      corpusManifestPath,
      corpusManifestSha256: hashContents(corpusContents),
      corpusProjectSetSha256: hashMatrixCorpusProjectSet([repository]),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    };
    const treatments = [
      buildTreatment({ temporaryDirectory, id: "pr-1", group, mode: "incremental" }),
      buildTreatment({ temporaryDirectory, id: "pr-2", group, mode: "incremental" }),
    ];
    matrixMocks.loadMatrixTreatments.mockResolvedValue(treatments);
    matrixMocks.evaluateMatrixRepositoryBatch.mockImplementation(
      async ({ lanes, onLaneRecord }) => {
        for (const lane of lanes) {
          await onLaneRecord(lane.id, {
            schemaVersion: 1,
            repository,
            evaluation: {
              reactDoctorRepository: lane.reactDoctorRepository,
              reactDoctorCommit: lane.reactDoctorRef,
              configContract: EVALUATION_CONFIG_CONTRACT,
              ruleSetHash: lane.kind === "base" ? group.baseFullRuleSetHash : "7".repeat(64),
              ruleKeys: lane.ruleKeys,
              evaluatorSourceHash: group.evaluatorSourceHash,
            },
            report: { complete: true },
          });
        }
        return [];
      },
    );
    fileSystemMocks.treatmentRenameFailuresRemaining = 1;
    fileSystemMocks.treatmentAbortFailuresRemaining = 1;

    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 2,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: {
          treatmentDescriptorPaths: treatments.map((treatment) => treatment.descriptorPath),
          waveWidth: 2,
        },
      }),
    ).rejects.toThrow("injected treatment rename failure");

    expect(fs.existsSync(treatments[0].descriptor.artifactDirectory)).toBe(false);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(treatments[1].descriptor.artifactDirectory, "provenance.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ laneId: "pr-2", status: "complete" });
    expect(fs.existsSync(group.baseArtifactPath)).toBe(true);
    expect(fs.readdirSync(temporaryDirectory).some((entry) => entry.includes(".partial-"))).toBe(
      false,
    );
  });

  it("identifies blocked treatments when no lane failed", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-blocked-treatment-"));
    temporaryDirectories.push(temporaryDirectory);
    const repository: CorpusRepository = {
      org: "example",
      name: "repository",
      ref: "f".repeat(40),
      rootDir: ".",
    };
    const corpusManifestPath = path.join(temporaryDirectory, "corpus.json");
    const corpusContents = `${JSON.stringify([repository])}\n`;
    fs.writeFileSync(corpusManifestPath, corpusContents);
    const baselineOutputPath = path.join(temporaryDirectory, "baseline.ndjson");
    const baselineProvenancePath = path.join(temporaryDirectory, "baseline.provenance.json");
    const baselineContents = "verified baseline\n";
    const baselineProvenanceContents = '{"schemaVersion":1}\n';
    fs.writeFileSync(baselineOutputPath, baselineContents);
    fs.writeFileSync(baselineProvenancePath, baselineProvenanceContents);
    const group = {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath,
      baselineProvenancePath,
      corpusManifestPath,
      corpusManifestSha256: hashContents(corpusContents),
      corpusProjectSetSha256: hashMatrixCorpusProjectSet([repository]),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    };
    const treatment = buildTreatment({
      temporaryDirectory,
      id: "pr-1",
      group,
      mode: "incremental",
    });
    matrixMocks.loadMatrixTreatments.mockResolvedValue([treatment]);
    matrixMocks.verifyMatrixBaselineCache.mockResolvedValueOnce({
      hit: true,
      invalid: false,
      artifact: {
        sha256: hashContents(baselineContents),
        byteLength: Buffer.byteLength(baselineContents),
        provenanceSha256: hashContents(baselineProvenanceContents),
      },
    });
    matrixMocks.evaluateMatrixRepositoryBatch.mockImplementation(
      async ({ lanes, onLaneRecord }) => {
        for (const lane of lanes) {
          await onLaneRecord(lane.id, {
            schemaVersion: 1,
            repository,
            evaluation: {
              reactDoctorRepository: lane.reactDoctorRepository,
              reactDoctorCommit: lane.reactDoctorRef,
              configContract: EVALUATION_CONFIG_CONTRACT,
              ruleSetHash: "7".repeat(64),
              ruleKeys: lane.ruleKeys,
              evaluatorSourceHash: group.evaluatorSourceHash,
            },
            report: { complete: true },
          });
        }
        fs.writeFileSync(baselineOutputPath, "changed after verification\n");
        return [];
      },
    );

    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 1,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: { treatmentDescriptorPaths: [treatment.descriptorPath], waveWidth: 1 },
      }),
    ).rejects.toThrow(
      "Matrix evaluation failed for blocked treatments: pr-1 (base artifact unavailable or failed verification)",
    );
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(treatment.descriptor.artifactDirectory, "provenance.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ laneId: "pr-1", status: "blocked" });
  });

  it("rejects an uppercase corpus ref before creating Daytona resources", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-uppercase-corpus-"));
    temporaryDirectories.push(temporaryDirectory);
    const repository = { org: "example", name: "repository", ref: "F".repeat(40), rootDir: "." };
    const corpusManifestPath = path.join(temporaryDirectory, "corpus.json");
    const corpusContents = `${JSON.stringify([repository])}\n`;
    fs.writeFileSync(corpusManifestPath, corpusContents);
    const group = {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
      baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
      corpusManifestPath,
      corpusManifestSha256: hashContents(corpusContents),
      corpusProjectSetSha256: hashMatrixCorpusProjectSet([repository]),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    };
    const treatment = buildTreatment({ temporaryDirectory, id: "pr-1", group, mode: "full" });
    matrixMocks.loadMatrixTreatments.mockResolvedValue([treatment]);

    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 1,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: { treatmentDescriptorPaths: [treatment.descriptorPath], waveWidth: 1 },
      }),
    ).rejects.toThrow("lowercase commit");
    expect(matrixMocks.snapshotCreate).not.toHaveBeenCalled();
    expect(matrixMocks.evaluateMatrixRepositoryBatch).not.toHaveBeenCalled();
  });

  it("clears a transient cleanup error after exact resource absence is proven", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-cleanup-failure-"));
    temporaryDirectories.push(temporaryDirectory);
    const repository: CorpusRepository = {
      org: "example",
      name: "repository",
      ref: "f".repeat(40),
      rootDir: ".",
    };
    const corpusManifestPath = path.join(temporaryDirectory, "corpus.json");
    const corpusContents = `${JSON.stringify([repository])}\n`;
    fs.writeFileSync(corpusManifestPath, corpusContents);
    const group = {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
      baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
      corpusManifestPath,
      corpusManifestSha256: hashContents(corpusContents),
      corpusProjectSetSha256: hashMatrixCorpusProjectSet([repository]),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    };
    const treatment = buildTreatment({
      temporaryDirectory,
      id: "pr-1",
      group,
      mode: "incremental",
    });
    matrixMocks.loadMatrixTreatments.mockResolvedValue([treatment]);
    matrixMocks.evaluateMatrixRepositoryBatch.mockImplementation(
      async ({ lanes, onLaneRecord }) => {
        for (const lane of lanes) {
          await onLaneRecord(lane.id, {
            schemaVersion: 1,
            repository,
            evaluation: {
              reactDoctorRepository: lane.reactDoctorRepository,
              reactDoctorCommit: lane.reactDoctorRef,
              configContract: EVALUATION_CONFIG_CONTRACT,
              ruleSetHash: "7".repeat(64),
              ruleKeys: lane.ruleKeys,
              evaluatorSourceHash: group.evaluatorSourceHash,
            },
            report: { complete: true },
          });
        }
        return [];
      },
    );
    matrixMocks.snapshotDelete.mockImplementationOnce(async () => {
      matrixMocks.snapshotDeleted = true;
      throw new Error("transient delete response failure");
    });
    let restorePerformanceNow: () => void = () => undefined;
    matrixMocks.cleanupEvaluationSandboxes.mockImplementationOnce(
      async ({ deadlineMilliseconds }) => {
        const cleanupStartedAt = globalThis.performance.now();
        expect(deadlineMilliseconds - cleanupStartedAt).toBeGreaterThan(
          CLEANUP_LONGER_THAN_OLD_LIMIT_MS,
        );
        const performanceNowSpy = vi
          .spyOn(globalThis.performance, "now")
          .mockReturnValueOnce(cleanupStartedAt + CLEANUP_LONGER_THAN_OLD_LIMIT_MS);
        restorePerformanceNow = () => performanceNowSpy.mockRestore();
      },
    );

    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 1,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: { treatmentDescriptorPaths: [treatment.descriptorPath], waveWidth: 1 },
      }),
    ).resolves.toBeUndefined();
    restorePerformanceNow();

    const artifactDirectory = treatment.descriptor.artifactDirectory;
    expect(
      JSON.parse(fs.readFileSync(path.join(artifactDirectory, "provenance.json"), "utf8")),
    ).toMatchObject({ status: "complete" });
    expect(fs.readFileSync(path.join(artifactDirectory, "base.ndjson"), "utf8")).not.toBe("");
    expect(fs.readFileSync(path.join(artifactDirectory, "candidate.ndjson"), "utf8")).not.toBe("");

    fs.rmSync(group.baseArtifactPath);
    matrixMocks.snapshotDeleted = false;
    matrixMocks.snapshotDelete.mockRejectedValueOnce(new Error("persistent delete failure"));
    matrixMocks.snapshotGet
      .mockResolvedValueOnce({ name: "snapshot" })
      .mockRejectedValueOnce(new Error("cleanup verification unavailable"));
    const secondTreatment = buildTreatment({
      temporaryDirectory,
      id: "pr-2",
      group,
      mode: "incremental",
    });
    matrixMocks.loadMatrixTreatments.mockResolvedValue([secondTreatment]);
    await expect(
      runMatrixCorpusEvaluation({
        repositoriesSources: [corpusManifestPath],
        repositoryLimit: 1,
        concurrency: 1,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "a".repeat(40),
        ruleKeys: [],
        matrix: { treatmentDescriptorPaths: [secondTreatment.descriptorPath], waveWidth: 1 },
      }),
    ).rejects.toThrow("Matrix Daytona cleanup was not verified");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(secondTreatment.descriptor.artifactDirectory, "provenance.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "complete" });
  });
});
