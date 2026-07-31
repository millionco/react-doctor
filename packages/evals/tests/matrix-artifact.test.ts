import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const fileSystemMocks = vi.hoisted(() => ({ recordRenameFailuresRemaining: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rename: async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (
        fileSystemMocks.recordRenameFailuresRemaining > 0 &&
        path.basename(String(oldPath)).startsWith(".partial-") &&
        String(newPath).endsWith(".ndjson")
      ) {
        fileSystemMocks.recordRenameFailuresRemaining -= 1;
        throw new Error("injected record rename failure");
      }
      return original.rename(oldPath, newPath);
    },
  };
});

import {
  EVALUATION_CONFIG_CONTRACT,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
} from "../src/constants.js";
import { createMatrixArtifactWriter } from "../src/matrix-artifact.js";
import type { LoadedMatrixTreatment } from "../src/matrix-treatment-descriptor.js";
import { createMatrixBaseArtifactBinding } from "../src/utils/matrix-base-artifact-binding.js";

const temporaryDirectories: string[] = [];
const corpusManifestContents = Buffer.from(
  `${JSON.stringify([{ org: "a", name: "one", ref: "f".repeat(40), rootDir: "." }])}\n`,
);
const corpusManifestSha256 = crypto
  .createHash("sha256")
  .update(corpusManifestContents)
  .digest("hex");

const buildTreatment = (
  temporaryDirectory: string,
  artifactDirectory: string,
): LoadedMatrixTreatment => ({
  descriptorPath: path.join(temporaryDirectory, "descriptor-source.json"),
  descriptorSha256: "1".repeat(64),
  descriptorContents: '{"descriptor":true}\n',
  impactManifestContents: '{"impact":true}\n',
  descriptor: {
    schemaVersion: 1,
    id: "pr-1",
    artifactDirectory,
    reactDoctorRepository: "https://github.com/example/react-doctor.git",
    reactDoctorCommit: "b".repeat(40),
    impactManifestPath: path.join(temporaryDirectory, "impact-source.json"),
    impactManifestSha256: "2".repeat(64),
    group: {
      baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      baseReactDoctorCommit: "a".repeat(40),
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
      baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
      baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
      corpusManifestPath: path.join(temporaryDirectory, "corpus.json"),
      corpusManifestSha256,
      corpusProjectSetSha256: "5".repeat(64),
      evaluatorSourceHash: "6".repeat(64),
      configContract: EVALUATION_CONFIG_CONTRACT,
      scanContract: MATRIX_SCAN_CONTRACT,
      reportContract: MATRIX_REPORT_CONTRACT,
      projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
    },
  },
  impactManifest: {
    schemaVersion: 1,
    mode: "incremental",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    changedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
    runtimeChangedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
    impactedRuleKeys: ["react-doctor/example"],
    candidateRuleKeys: ["react-doctor/example"],
    fallbackReasons: [],
    rules: [
      {
        ruleKey: "react-doctor/example",
        baseFingerprint: "8".repeat(64),
        headFingerprint: "9".repeat(64),
      },
    ],
  },
  ruleKeys: ["react-doctor/example"],
});

afterEach(() => {
  fileSystemMocks.recordRenameFailuresRemaining = 0;
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("createMatrixArtifactWriter", () => {
  it("publishes one complete per-treatment directory with frozen evidence atomically", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-artifact-"));
    temporaryDirectories.push(temporaryDirectory);
    const artifactDirectory = path.join(temporaryDirectory, "pr-1");
    const baseArtifactPath = path.join(temporaryDirectory, "base.ndjson");
    const baseProvenancePath = path.join(temporaryDirectory, "base.provenance.json");
    fs.writeFileSync(baseArtifactPath, "base\n");
    fs.writeFileSync(baseProvenancePath, '{"schemaVersion":1}\n');
    const baseArtifact = await createMatrixBaseArtifactBinding({
      sourcePath: baseArtifactPath,
      provenanceSourcePath: baseProvenancePath,
      producer: {
        reactDoctorRepository: "https://github.com/example/react-doctor.git",
        reactDoctorCommit: "b".repeat(40),
        configContract: EVALUATION_CONFIG_CONTRACT,
        ruleSetHash: "7".repeat(64),
        ruleKeys: ["react-doctor/example"],
        evaluatorSourceHash: "6".repeat(64),
      },
    });
    const writer = await createMatrixArtifactWriter({
      evaluationId: "evaluation-id",
      treatment: buildTreatment(temporaryDirectory, artifactDirectory),
      expectedProjectCount: 1,
      corpusManifestContents,
    });
    expect(fs.existsSync(artifactDirectory)).toBe(false);
    await writer.write({
      schemaVersion: 1,
      repository: { org: "a", name: "one", ref: "f".repeat(40), rootDir: "." },
      evaluation: {
        reactDoctorRepository: "https://github.com/example/react-doctor.git",
        reactDoctorCommit: "b".repeat(40),
        configContract: EVALUATION_CONFIG_CONTRACT,
        ruleSetHash: "7".repeat(64),
        ruleKeys: ["react-doctor/example"],
        evaluatorSourceHash: "6".repeat(64),
      },
      report: { complete: true },
    });

    const provenance = await writer.finalize(baseArtifact);

    expect(provenance).toMatchObject({
      status: "complete",
      recordCount: 1,
      failedRecordCount: 0,
      ruleKeys: ["react-doctor/example"],
      rulesSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      corpusManifest: {
        path: "corpus-manifest.json",
        sha256: corpusManifestSha256,
        byteLength: corpusManifestContents.byteLength,
      },
      baseArtifact: {
        path: "base.ndjson",
        provenancePath: "base-provenance.json",
        provenanceSha256: baseArtifact.provenanceSha256,
        verified: true,
      },
    });
    expect(provenance).not.toHaveProperty("baseArtifactPath");
    expect(provenance.baseArtifact).not.toHaveProperty("sourcePath");
    expect(provenance.baseArtifact).not.toHaveProperty("provenanceSourcePath");
    expect(fs.readdirSync(artifactDirectory).sort()).toEqual([
      "base-provenance.json",
      "base.ndjson",
      "candidate.ndjson",
      "corpus-manifest.json",
      "descriptor.json",
      "impact-manifest.json",
      "provenance.json",
      "rules.json",
    ]);
    expect(fs.readdirSync(temporaryDirectory).some((name) => name.startsWith(".partial-"))).toBe(
      false,
    );
  });

  it("cleans only its exact pending directory on abort", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-abort-"));
    temporaryDirectories.push(temporaryDirectory);
    const unrelatedPath = path.join(temporaryDirectory, ".partial-unrelated");
    fs.mkdirSync(unrelatedPath);
    const writer = await createMatrixArtifactWriter({
      evaluationId: "evaluation-id",
      treatment: buildTreatment(temporaryDirectory, path.join(temporaryDirectory, "pr-1")),
      expectedProjectCount: 1,
      corpusManifestContents,
    });

    await writer.abort();

    expect(fs.existsSync(unrelatedPath)).toBe(true);
    expect(fs.readdirSync(temporaryDirectory)).toEqual([".partial-unrelated"]);
  });

  it("spools concurrent records independently and rejects duplicate project emission", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-spool-"));
    temporaryDirectories.push(temporaryDirectory);
    const artifactDirectory = path.join(temporaryDirectory, "pr-1");
    const writer = await createMatrixArtifactWriter({
      evaluationId: "evaluation-id",
      treatment: buildTreatment(temporaryDirectory, artifactDirectory),
      expectedProjectCount: 2,
      corpusManifestContents,
    });
    const firstRecord = {
      schemaVersion: 1,
      repository: { org: "a", name: "one", ref: "1".repeat(40), rootDir: "." },
      error: "first",
    };
    const secondRecord = {
      schemaVersion: 1,
      repository: { org: "b", name: "two", ref: "2".repeat(40), rootDir: "." },
      error: "second",
    };
    await Promise.all([writer.write(secondRecord), writer.write(firstRecord)]);
    await expect(writer.write(firstRecord)).rejects.toThrow("Duplicate matrix project record");
    await writer.finalize();

    const records = fs
      .readFileSync(path.join(artifactDirectory, "candidate.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.repository.name).sort()).toEqual(["one", "two"]);
  });

  it("removes a failed pending record so the project can be retried", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-spool-retry-"));
    temporaryDirectories.push(temporaryDirectory);
    const artifactDirectory = path.join(temporaryDirectory, "pr-1");
    const writer = await createMatrixArtifactWriter({
      evaluationId: "evaluation-id",
      treatment: buildTreatment(temporaryDirectory, artifactDirectory),
      expectedProjectCount: 1,
      corpusManifestContents,
    });
    const record = {
      schemaVersion: 1,
      repository: { org: "a", name: "one", ref: "1".repeat(40), rootDir: "." },
      error: "retryable",
    };
    fileSystemMocks.recordRenameFailuresRemaining = 1;

    await expect(writer.write(record)).rejects.toThrow("injected record rename failure");
    const pendingRecordsDirectory = path.join(
      temporaryDirectory,
      ".partial-pr-1-evaluation-id",
      "records",
    );
    expect(fs.readdirSync(pendingRecordsDirectory)).toEqual([]);

    await expect(writer.write(record)).resolves.toBeUndefined();
    await writer.finalize();
    expect(
      fs.readFileSync(path.join(artifactDirectory, "candidate.ndjson"), "utf8").trim().split("\n"),
    ).toHaveLength(1);
  });

  it("blocks publication when the bound base bytes change before finalization", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-base-binding-"));
    temporaryDirectories.push(temporaryDirectory);
    const baseArtifactPath = path.join(temporaryDirectory, "base.ndjson");
    fs.writeFileSync(baseArtifactPath, "original\n");
    const producer = {
      reactDoctorRepository: "https://github.com/example/react-doctor.git",
      reactDoctorCommit: "b".repeat(40),
      configContract: EVALUATION_CONFIG_CONTRACT,
      ruleSetHash: "7".repeat(64),
      ruleKeys: ["react-doctor/example"],
      evaluatorSourceHash: "6".repeat(64),
    };
    const baseArtifact = await createMatrixBaseArtifactBinding({
      sourcePath: baseArtifactPath,
      producer,
    });
    const artifactDirectory = path.join(temporaryDirectory, "pr-1");
    const writer = await createMatrixArtifactWriter({
      evaluationId: "evaluation-id",
      treatment: buildTreatment(temporaryDirectory, artifactDirectory),
      expectedProjectCount: 1,
      corpusManifestContents,
    });
    await writer.write({
      schemaVersion: 1,
      repository: { org: "a", name: "one", ref: "f".repeat(40), rootDir: "." },
      evaluation: producer,
      report: { complete: true },
    });
    fs.writeFileSync(baseArtifactPath, "replacement\n");

    const provenance = await writer.finalize(baseArtifact);

    expect(provenance.status).toBe("blocked");
    expect(provenance.baseArtifact).toMatchObject({
      contract: "matrix-base-artifact-v1",
      sha256: baseArtifact.sha256,
      byteLength: baseArtifact.byteLength,
      producerSha256: baseArtifact.producerSha256,
      verified: false,
    });
    expect(fs.existsSync(path.join(artifactDirectory, "base.ndjson"))).toBe(false);
  });
});
