import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  EVALUATION_CONFIG_CONTRACT,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
} from "../src/constants.js";
import type { MatrixEvaluationGroup } from "../src/matrix-treatment-descriptor.js";
import { createMatrixBaseArtifactBinding } from "../src/utils/matrix-base-artifact-binding.js";
import { verifyMatrixBaselineCache } from "../src/verify-matrix-baseline-cache.js";

const temporaryDirectories: string[] = [];

const buildGroup = (temporaryDirectory: string): MatrixEvaluationGroup => ({
  baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
  baseReactDoctorCommit: "a".repeat(40),
  baseFullRuleSetHash: "b".repeat(64),
  baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
  baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
  baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
  corpusManifestPath: path.join(temporaryDirectory, "corpus.json"),
  corpusManifestSha256: "c".repeat(64),
  corpusProjectSetSha256: "d".repeat(64),
  evaluatorSourceHash: "e".repeat(64),
  configContract: EVALUATION_CONFIG_CONTRACT,
  scanContract: MATRIX_SCAN_CONTRACT,
  reportContract: MATRIX_REPORT_CONTRACT,
  projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
});

const buildReport = () => ({
  schemaVersion: 3,
  version: "0.9.2",
  ok: true,
  directory: "/workspace/target",
  mode: "full",
  diff: null,
  projects: [
    {
      directory: "/workspace/target",
      packageRoot: "/workspace/target",
      framework: "vite",
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

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("verifyMatrixBaselineCache", () => {
  it("distinguishes a clean miss from a partial invalid cache", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-cache-miss-"));
    temporaryDirectories.push(temporaryDirectory);
    const group = buildGroup(temporaryDirectory);
    await expect(verifyMatrixBaselineCache(group)).resolves.toMatchObject({
      hit: false,
      invalid: false,
    });
    fs.writeFileSync(group.baselineOutputPath, "partial");
    await expect(verifyMatrixBaselineCache(group)).resolves.toMatchObject({
      hit: false,
      invalid: true,
    });
  });

  it("accepts only a baseline that passes the immutable streaming verifier", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-cache-hit-"));
    temporaryDirectories.push(temporaryDirectory);
    const group = buildGroup(temporaryDirectory);
    const repository = { org: "example", name: "repository", ref: "f".repeat(40), rootDir: "." };
    fs.writeFileSync(group.corpusManifestPath, `${JSON.stringify([repository])}\n`);
    fs.writeFileSync(
      group.baselineOutputPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repository,
        evaluation: {
          reactDoctorRepository: group.baseReactDoctorRepository,
          reactDoctorCommit: group.baseReactDoctorCommit,
          evaluatorSourceHash: group.evaluatorSourceHash,
          configContract: group.configContract,
          ruleSetHash: group.baseFullRuleSetHash,
          ruleKeys: [],
        },
        report: buildReport(),
      })}\n`,
    );
    const verifierPath = fileURLToPath(
      new URL(
        "../../../.agents/skills/run-parity/scripts/baseline-cache-provenance.mjs",
        import.meta.url,
      ),
    );
    execFileSync(process.execPath, [
      verifierPath,
      "create",
      "--baseline",
      group.baselineOutputPath,
      "--provenance",
      group.baselineProvenancePath,
      "--corpus-manifest",
      group.corpusManifestPath,
      "--base-commit",
      group.baseReactDoctorCommit,
      "--repository",
      group.baseReactDoctorRepository,
      "--evaluator-source-hash",
      group.evaluatorSourceHash,
      "--config-contract",
      group.configContract,
      "--rule-set-hash",
      group.baseFullRuleSetHash,
    ]);

    await expect(
      verifyMatrixBaselineCache(group, globalThis.performance.now()),
    ).resolves.toMatchObject({
      hit: false,
      invalid: true,
      reason: expect.stringContaining("Evaluation time budget exhausted"),
    });

    const verification = await verifyMatrixBaselineCache(group);
    expect(verification).toMatchObject({
      hit: true,
      invalid: false,
      artifact: {
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        byteLength: expect.any(Number),
        provenanceSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    fs.appendFileSync(group.baselineOutputPath, " ");
    await expect(
      createMatrixBaseArtifactBinding({
        sourcePath: group.baselineOutputPath,
        provenanceSourcePath: group.baselineProvenancePath,
        producer: {
          reactDoctorRepository: group.baseReactDoctorRepository,
          reactDoctorCommit: group.baseReactDoctorCommit,
          evaluatorSourceHash: group.evaluatorSourceHash,
          configContract: group.configContract,
          ruleSetHash: group.baseFullRuleSetHash,
          ruleKeys: [],
        },
        expected: verification.artifact,
      }),
    ).rejects.toThrow("changed after verification");
    await expect(verifyMatrixBaselineCache(group)).resolves.toMatchObject({
      hit: false,
      invalid: true,
    });
  });
});
