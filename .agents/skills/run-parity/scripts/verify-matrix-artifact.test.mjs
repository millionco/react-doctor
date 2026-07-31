import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyMatrixArtifact } from "./verify-matrix-artifact.mjs";

const hash = (contents) => createHash("sha256").update(contents).digest("hex");

const compareCodeUnitStrings = (left, right) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const hashProjectSet = (repositories) =>
  hash(
    JSON.stringify(
      repositories
        .map(({ org, name, ref, rootDir }) => JSON.stringify([org, name, ref, rootDir]))
        .sort(compareCodeUnitStrings)
        .map((projectKey) => JSON.parse(projectKey)),
    ),
  );

const buildReport = (rootDir) => ({
  schemaVersion: 3,
  ok: true,
  version: "0.0.0-test",
  directory: `/workspace/target/${rootDir}`,
  mode: "full",
  diff: null,
  projects: [
    {
      directory: `/workspace/target/${rootDir}`,
      packageRoot: `/workspace/target/${rootDir}`,
      framework: "vite",
      diagnostics: [],
      skippedChecks: [],
      project: null,
      score: null,
      scannedFileCount: 0,
      elapsedMilliseconds: 1,
      analyzedFiles: [],
      analyzedFileCount: 0,
      complete: true,
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

const serializeRecords = (repositories, evaluation) =>
  repositories
    .map((repository) =>
      JSON.stringify({
        schemaVersion: 1,
        repository,
        evaluation,
        report: buildReport(repository.rootDir),
      }),
    )
    .join("\n") + "\n";

const withArtifact = async (
  callback,
  repositories = [
    { org: "example", name: "first", ref: "c".repeat(40), rootDir: "." },
    { org: "example", name: "second", ref: "d".repeat(40), rootDir: "packages/app" },
  ],
) => {
  const directory = await mkdtemp(join(tmpdir(), "verify-matrix-artifact-"));
  const artifactDirectory = join(directory, "artifact");
  await mkdir(artifactDirectory);
  const rules = ["react-doctor/example"];
  const candidateProducer = {
    reactDoctorRepository: directory,
    reactDoctorCommit: "b".repeat(40),
    configContract: "revision-local-rule-config-v1",
    ruleSetHash: "7".repeat(64),
    ruleKeys: rules,
    evaluatorSourceHash: "6".repeat(64),
  };
  const baseProducer = {
    reactDoctorRepository: directory,
    reactDoctorCommit: "a".repeat(40),
    configContract: "revision-local-rule-config-v1",
    ruleSetHash: "3".repeat(64),
    ruleKeys: [],
    evaluatorSourceHash: "6".repeat(64),
  };
  const candidate = serializeRecords(repositories, candidateProducer);
  const base = serializeRecords(repositories, baseProducer);
  const corpusManifest = `${JSON.stringify(repositories, null, 2)}\n`;
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
      corpusManifestSha256: hash(corpusManifest),
      corpusProjectSetSha256: hashProjectSet(repositories),
      evaluatorSourceHash: "6".repeat(64),
      configContract: "revision-local-rule-config-v1",
      scanContract: "react-doctor-json-full-v1",
      reportContract: "react-doctor-complete-report-v1",
      projectRootPolicy: "manifest-root-dir-v1",
    },
  };
  const descriptorContents = `${JSON.stringify(descriptor)}\n`;
  await Promise.all([
    writeFile(join(artifactDirectory, "candidate.ndjson"), candidate),
    writeFile(join(artifactDirectory, "base.ndjson"), base),
    writeFile(join(artifactDirectory, "corpus-manifest.json"), corpusManifest),
    writeFile(join(artifactDirectory, "rules.json"), rulesContents),
    writeFile(join(artifactDirectory, "impact-manifest.json"), impactManifestContents),
    writeFile(join(artifactDirectory, "descriptor.json"), descriptorContents),
  ]);
  const provenance = {
    schemaVersion: 1,
    evaluationId: "evaluation-id",
    laneId: "pr-1",
    status: "complete",
    expectedProjectCount: repositories.length,
    recordCount: repositories.length,
    failedRecordCount: 0,
    artifact: {
      path: "candidate.ndjson",
      sha256: hash(candidate),
      byteLength: Buffer.byteLength(candidate),
    },
    corpusManifest: {
      path: "corpus-manifest.json",
      sha256: hash(corpusManifest),
      byteLength: Buffer.byteLength(corpusManifest),
    },
    descriptorSha256: hash(descriptorContents),
    impactManifestSha256: hash(impactManifestContents),
    rulesSha256: hash(rulesContents),
    baseArtifact: {
      contract: "matrix-base-artifact-v1",
      path: "base.ndjson",
      sha256: hash(base),
      byteLength: Buffer.byteLength(base),
      producer: baseProducer,
      producerSha256: hash(JSON.stringify(baseProducer)),
      verified: true,
    },
    ruleKeys: rules,
    evaluation: candidateProducer,
  };
  const writeProvenance = () =>
    writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify(provenance));
  const writeDescriptor = async () => {
    const contents = `${JSON.stringify(descriptor)}\n`;
    await writeFile(join(artifactDirectory, "descriptor.json"), contents);
    provenance.descriptorSha256 = hash(contents);
  };
  const replaceCorpusManifest = async (nextRepositories) => {
    const contents = `${JSON.stringify(nextRepositories, null, 2)}\n`;
    await writeFile(join(artifactDirectory, "corpus-manifest.json"), contents);
    provenance.corpusManifest.sha256 = hash(contents);
    provenance.corpusManifest.byteLength = Buffer.byteLength(contents);
    descriptor.group.corpusManifestSha256 = hash(contents);
    descriptor.group.corpusProjectSetSha256 = hashProjectSet(nextRepositories);
    await writeDescriptor();
    await writeProvenance();
  };
  await writeProvenance();
  try {
    await callback({
      artifactDirectory,
      descriptor,
      impactManifest,
      provenance,
      repositories,
      candidateProducer,
      baseProducer,
      writeProvenance,
      replaceCorpusManifest,
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

test("accepts mixed-case project tuples without consulting the process locale", async () => {
  const localeCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error("locale-sensitive comparison used");
  };
  try {
    await withArtifact(
      async ({ artifactDirectory }) => {
        await assert.doesNotReject(verifyMatrixArtifact(artifactDirectory));
      },
      [
        { org: "Z-owner", name: "first", ref: "c".repeat(40), rootDir: "." },
        { org: "a-owner", name: "second", ref: "d".repeat(40), rootDir: "packages/app" },
      ],
    );
  } finally {
    String.prototype.localeCompare = localeCompare;
  }
});

test("rejects tampered bundled corpus bytes", async () => {
  await withArtifact(async ({ artifactDirectory }) => {
    await writeFile(join(artifactDirectory, "corpus-manifest.json"), "[]\n");
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /bytes do not match provenance/);
  });
});

test("accepts a rebound manifest ordering with the same bound project set", async () => {
  await withArtifact(async ({ artifactDirectory, repositories, replaceCorpusManifest }) => {
    await replaceCorpusManifest([...repositories].reverse());
    await assert.doesNotReject(verifyMatrixArtifact(artifactDirectory));
  });
});

test("rejects a rebound corpus manifest with an unpinned project", async () => {
  await withArtifact(async ({ artifactDirectory, repositories, replaceCorpusManifest }) => {
    await replaceCorpusManifest([{ ...repositories[0], ref: "main" }, repositories[1]]);
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /repository 1 is invalid/);
  });
});

test("rejects a rebound corpus manifest with a duplicate project", async () => {
  await withArtifact(async ({ artifactDirectory, repositories, replaceCorpusManifest }) => {
    await replaceCorpusManifest([repositories[0], repositories[0]]);
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /repository 2 is duplicated/);
  });
});

test("rejects a rebound corpus manifest whose count differs from provenance", async () => {
  await withArtifact(async ({ artifactDirectory, repositories, replaceCorpusManifest }) => {
    await replaceCorpusManifest(repositories.slice(0, 1));
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /count or project set/);
  });
});

test("rejects rehashed truncated artifacts despite claimed completion", async () => {
  await withArtifact(
    async ({
      artifactDirectory,
      provenance,
      repositories,
      candidateProducer,
      baseProducer,
      writeProvenance,
    }) => {
      const candidate = serializeRecords(repositories.slice(0, 1), candidateProducer);
      const base = serializeRecords(repositories.slice(0, 1), baseProducer);
      await Promise.all([
        writeFile(join(artifactDirectory, "candidate.ndjson"), candidate),
        writeFile(join(artifactDirectory, "base.ndjson"), base),
      ]);
      provenance.artifact.sha256 = hash(candidate);
      provenance.artifact.byteLength = Buffer.byteLength(candidate);
      provenance.baseArtifact.sha256 = hash(base);
      provenance.baseArtifact.byteLength = Buffer.byteLength(base);
      await writeProvenance();
      await assert.rejects(verifyMatrixArtifact(artifactDirectory), /record count/);
    },
  );
});

test("rejects a rehashed matching pair rebound to another project set", async () => {
  await withArtifact(
    async ({ artifactDirectory, provenance, candidateProducer, baseProducer, writeProvenance }) => {
      const reboundRepositories = [
        { org: "attacker", name: "rebound", ref: "e".repeat(40), rootDir: "." },
        { org: "attacker", name: "second", ref: "f".repeat(40), rootDir: "apps/web" },
      ];
      const candidate = serializeRecords(reboundRepositories, candidateProducer);
      const base = serializeRecords(reboundRepositories, baseProducer);
      await Promise.all([
        writeFile(join(artifactDirectory, "candidate.ndjson"), candidate),
        writeFile(join(artifactDirectory, "base.ndjson"), base),
      ]);
      provenance.artifact.sha256 = hash(candidate);
      provenance.artifact.byteLength = Buffer.byteLength(candidate);
      provenance.baseArtifact.sha256 = hash(base);
      provenance.baseArtifact.byteLength = Buffer.byteLength(base);
      await writeProvenance();
      await assert.rejects(verifyMatrixArtifact(artifactDirectory), /project set/);
    },
  );
});

test("rejects complete records with producer provenance outside the descriptor", async () => {
  await withArtifact(
    async ({ artifactDirectory, provenance, repositories, candidateProducer, writeProvenance }) => {
      const changedProducer = { ...candidateProducer, reactDoctorCommit: "9".repeat(40) };
      const candidate = serializeRecords(repositories, changedProducer);
      await writeFile(join(artifactDirectory, "candidate.ndjson"), candidate);
      provenance.artifact.sha256 = hash(candidate);
      provenance.artifact.byteLength = Buffer.byteLength(candidate);
      provenance.evaluation = changedProducer;
      await writeProvenance();
      await assert.rejects(verifyMatrixArtifact(artifactDirectory), /matrix descriptor/);
    },
  );
});

test("rejects incomplete reports after artifact bytes are rebound", async () => {
  await withArtifact(
    async ({ artifactDirectory, provenance, repositories, candidateProducer, writeProvenance }) => {
      const records = serializeRecords(repositories, candidateProducer)
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      records[0].report.projects[0].complete = false;
      const candidate = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
      await writeFile(join(artifactDirectory, "candidate.ndjson"), candidate);
      provenance.artifact.sha256 = hash(candidate);
      provenance.artifact.byteLength = Buffer.byteLength(candidate);
      await writeProvenance();
      await assert.rejects(verifyMatrixArtifact(artifactDirectory), /incomplete record/);
    },
  );
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
