import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyMatrixArtifact } from "./verify-matrix-artifact.mjs";

const hash = (contents) => createHash("sha256").update(contents).digest("hex");

const withArtifact = async (callback) => {
  const directory = await mkdtemp(join(tmpdir(), "verify-matrix-artifact-"));
  const artifactDirectory = join(directory, "artifact");
  await mkdir(artifactDirectory);
  const candidate = "candidate\n";
  const base = "base\n";
  const rules = ["react-doctor/example"];
  const rulesContents = `${JSON.stringify(rules, null, 2)}\n`;
  const impactManifest = {
    schemaVersion: 1,
    mode: "incremental",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    changedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
    runtimeChangedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
    impactedRuleKeys: rules,
    candidateRuleKeys: rules,
    fallbackReasons: [],
    rules: [
      {
        ruleKey: "react-doctor/example",
        baseFingerprint: "1".repeat(64),
        headFingerprint: "2".repeat(64),
      },
    ],
  };
  const impactManifestContents = `${JSON.stringify(impactManifest)}\n`;
  const descriptor = {
    schemaVersion: 1,
    id: "pr-1",
    artifactDirectory,
    reactDoctorRepository: directory,
    reactDoctorCommit: impactManifest.headCommit,
    impactManifestPath: join(directory, "impact.json"),
    impactManifestSha256: hash(impactManifestContents),
    group: {
      baseReactDoctorRepository: directory,
      baseReactDoctorCommit: impactManifest.baseCommit,
      baseFullRuleSetHash: "3".repeat(64),
      baseArtifactPath: join(directory, "base-scoped.ndjson"),
      baselineOutputPath: join(directory, "baseline.ndjson"),
      baselineProvenancePath: join(directory, "baseline.provenance.json"),
      corpusManifestPath: join(directory, "corpus.json"),
      corpusManifestSha256: "4".repeat(64),
      corpusProjectSetSha256: "5".repeat(64),
      evaluatorSourceHash: "6".repeat(64),
      configContract: "revision-local-rule-config-v1",
      scanContract: "react-doctor-json-full-v1",
      reportContract: "react-doctor-complete-report-v1",
      projectRootPolicy: "manifest-root-dir-v1",
    },
  };
  const descriptorContents = `${JSON.stringify(descriptor)}\n`;
  const producer = { ruleKeys: rules };
  await Promise.all([
    writeFile(join(artifactDirectory, "candidate.ndjson"), candidate),
    writeFile(join(artifactDirectory, "base.ndjson"), base),
    writeFile(join(artifactDirectory, "rules.json"), rulesContents),
    writeFile(join(artifactDirectory, "impact-manifest.json"), impactManifestContents),
    writeFile(join(artifactDirectory, "descriptor.json"), descriptorContents),
  ]);
  const provenance = {
    schemaVersion: 1,
    evaluationId: "evaluation-id",
    laneId: "pr-1",
    status: "complete",
    expectedProjectCount: 1,
    recordCount: 1,
    failedRecordCount: 0,
    artifact: {
      path: "candidate.ndjson",
      sha256: hash(candidate),
      byteLength: Buffer.byteLength(candidate),
    },
    descriptorSha256: hash(descriptorContents),
    impactManifestSha256: hash(impactManifestContents),
    rulesSha256: hash(rulesContents),
    baseArtifact: {
      contract: "matrix-base-artifact-v1",
      path: "base.ndjson",
      sha256: hash(base),
      byteLength: Buffer.byteLength(base),
      producer,
      producerSha256: hash(JSON.stringify(producer)),
      verified: true,
    },
    ruleKeys: rules,
  };
  const writeProvenance = () =>
    writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify(provenance));
  await writeProvenance();
  try {
    await callback({
      artifactDirectory,
      descriptor,
      impactManifest,
      provenance,
      writeProvenance,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("accepts bundled canonical matrix evidence", async () => {
  await withArtifact(async ({ artifactDirectory }) => {
    await assert.doesNotReject(verifyMatrixArtifact(artifactDirectory));
  });
});

test("rejects mutable source paths and changed bundled bytes", async () => {
  await withArtifact(async ({ artifactDirectory, provenance, writeProvenance }) => {
    provenance.baseArtifact.sourcePath = "/mutable/base.ndjson";
    await writeProvenance();
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /unexpected fields/);
    delete provenance.baseArtifact.sourcePath;
    await writeProvenance();
    await writeFile(join(artifactDirectory, "base.ndjson"), "replacement\n");
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /bytes do not match provenance/);
  });
});

test("rejects a rehashed rules file outside the bound candidate scope", async () => {
  await withArtifact(async ({ artifactDirectory, provenance, writeProvenance }) => {
    const changedRulesContents = "[]\n";
    await writeFile(join(artifactDirectory, "rules.json"), changedRulesContents);
    provenance.rulesSha256 = hash(changedRulesContents);
    provenance.ruleKeys = [];
    await writeProvenance();
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /bound candidate scope/);
  });
});

test("rejects rehashed descriptor and impact schema drift", async () => {
  await withArtifact(
    async ({ artifactDirectory, descriptor, impactManifest, provenance, writeProvenance }) => {
      const changedImpactContents = `${JSON.stringify({ ...impactManifest, extra: true })}\n`;
      await writeFile(join(artifactDirectory, "impact-manifest.json"), changedImpactContents);
      provenance.impactManifestSha256 = hash(changedImpactContents);
      descriptor.impactManifestSha256 = provenance.impactManifestSha256;
      const changedDescriptorContents = `${JSON.stringify(descriptor)}\n`;
      await writeFile(join(artifactDirectory, "descriptor.json"), changedDescriptorContents);
      provenance.descriptorSha256 = hash(changedDescriptorContents);
      await writeProvenance();
      await assert.rejects(verifyMatrixArtifact(artifactDirectory), /unexpected fields/);
    },
  );
});
