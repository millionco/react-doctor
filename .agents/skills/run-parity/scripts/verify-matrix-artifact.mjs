import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { diagnosticsByIdentity, readRun, validateRepository } from "./compare-parity.mjs";

const MATRIX_BASE_ARTIFACT_CONTRACT = "matrix-base-artifact-v1";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RULE_KEY_PATTERN = /^(?:react-doctor|react-hooks-js)\/[a-z0-9][a-zA-Z0-9-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DESCRIPTOR_KEYS = [
  "schemaVersion",
  "id",
  "artifactDirectory",
  "reactDoctorRepository",
  "reactDoctorCommit",
  "impactManifestPath",
  "impactManifestSha256",
  "group",
];
const GROUP_KEYS = [
  "baseReactDoctorRepository",
  "baseReactDoctorCommit",
  "baseFullRuleSetHash",
  "baseArtifactPath",
  "baselineOutputPath",
  "baselineProvenancePath",
  "corpusManifestPath",
  "corpusManifestSha256",
  "corpusProjectSetSha256",
  "evaluatorSourceHash",
  "configContract",
  "scanContract",
  "reportContract",
  "projectRootPolicy",
];
const IMPACT_MANIFEST_KEYS = [
  "schemaVersion",
  "mode",
  "baseCommit",
  "headCommit",
  "changedPaths",
  "runtimeChangedPaths",
  "impactedRuleKeys",
  "candidateRuleKeys",
  "fallbackReasons",
  "rules",
];
const PRODUCER_KEYS = [
  "reactDoctorRepository",
  "reactDoctorCommit",
  "configContract",
  "ruleSetHash",
  "ruleKeys",
  "evaluatorSourceHash",
];
const PROJECT_KEYS = ["name", "org", "ref", "rootDir"];

const hashBytes = (contents) => createHash("sha256").update(contents).digest("hex");

const hashFile = async (filePath) => hashBytes(await readFile(filePath));

const compareCodeUnitStrings = (left, right) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const assertObject = (value, description) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value;
};

const assertExactKeys = (value, expectedKeys, description) => {
  const actualKeys = Object.keys(assertObject(value, description)).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error(`${description} has unexpected fields`);
  }
};

const assertSha256 = (value, description) => {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${description} must be a lowercase SHA-256 digest`);
  }
};

const assertStringArray = (value, description) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${description} must be a string array`);
  }
};

const assertNonemptyString = (value, description) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a nonempty string`);
  }
};

const assertCommit = (value, description) => {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    throw new Error(`${description} must be a lowercase 40-character commit`);
  }
};

const assertProducer = (producer, description) => {
  assertExactKeys(producer, PRODUCER_KEYS, description);
  assertNonemptyString(producer.reactDoctorRepository, `${description}.reactDoctorRepository`);
  assertCommit(producer.reactDoctorCommit, `${description}.reactDoctorCommit`);
  assertNonemptyString(producer.configContract, `${description}.configContract`);
  assertSha256(producer.ruleSetHash, `${description}.ruleSetHash`);
  assertStringArray(producer.ruleKeys, `${description}.ruleKeys`);
  assertSha256(producer.evaluatorSourceHash, `${description}.evaluatorSourceHash`);
};

const projectSetSha256 = (projectKeys) => {
  const tuples = [...projectKeys]
    .sort(compareCodeUnitStrings)
    .map((projectKey) => JSON.parse(projectKey));
  return hashBytes(JSON.stringify(tuples));
};

const loadCorpusProjectKeys = async (filePath) => {
  let repositories;
  try {
    repositories = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Matrix corpus manifest is not valid JSON");
  }
  if (!Array.isArray(repositories) || repositories.length === 0) {
    throw new Error("Matrix corpus manifest must be a nonempty array");
  }
  const projectKeys = new Set();
  for (const [repositoryIndex, repository] of repositories.entries()) {
    if (
      !validateRepository(repository) ||
      JSON.stringify(Object.keys(repository).sort()) !== JSON.stringify(PROJECT_KEYS)
    ) {
      throw new Error(`Matrix corpus manifest repository ${repositoryIndex + 1} is invalid`);
    }
    const projectKey = JSON.stringify([
      repository.org,
      repository.name,
      repository.ref,
      repository.rootDir,
    ]);
    if (projectKeys.has(projectKey)) {
      throw new Error(`Matrix corpus manifest repository ${repositoryIndex + 1} is duplicated`);
    }
    projectKeys.add(projectKey);
  }
  return projectKeys;
};

const assertProducerMatches = ({ producer, expected, description }) => {
  for (const field of [
    "reactDoctorRepository",
    "reactDoctorCommit",
    "configContract",
    "evaluatorSourceHash",
  ]) {
    if (producer[field] !== expected[field]) {
      throw new Error(`${description}.${field} does not match the matrix descriptor`);
    }
  }
};

const validateArtifactRun = async ({
  filePath,
  description,
  expectedProjectCount,
  expectedProjectSetSha256,
  expectedProducer,
}) => {
  const projectKeys = new Set();
  const recordCount = await readRun(filePath, async (record, projectKey) => {
    if (projectKeys.has(projectKey)) {
      throw new Error(`${description} contains a duplicate project record`);
    }
    projectKeys.add(projectKey);
    const reportValidation = diagnosticsByIdentity(record, false);
    if (reportValidation.error) {
      throw new Error(`${description} contains an incomplete record: ${reportValidation.error}`);
    }
    assertProducer(record.evaluation, `${description} record producer`);
    if (!isDeepStrictEqual(record.evaluation, expectedProducer)) {
      throw new Error(`${description} record producer does not match provenance`);
    }
  });
  if (recordCount !== expectedProjectCount) {
    throw new Error(`${description} record count does not match provenance`);
  }
  if (projectSetSha256(projectKeys) !== expectedProjectSetSha256) {
    throw new Error(`${description} project set does not match the matrix corpus`);
  }
  return projectKeys;
};

const assertFileBinding = async ({ artifactDirectory, binding, expectedPath, description }) => {
  assertExactKeys(binding, ["path", "sha256", "byteLength"], `${description} binding`);
  if (
    binding.path !== expectedPath ||
    !Number.isSafeInteger(binding.byteLength) ||
    binding.byteLength <= 0
  ) {
    throw new Error(`${description} binding is invalid`);
  }
  assertSha256(binding.sha256, `${description} binding sha256`);
  const filePath = join(artifactDirectory, expectedPath);
  const [fileStats, sha256] = await Promise.all([stat(filePath), hashFile(filePath)]);
  if (fileStats.size !== binding.byteLength || sha256 !== binding.sha256) {
    throw new Error(`${description} bytes do not match provenance`);
  }
};

const loadBoundJson = async ({ artifactDirectory, path, expectedSha256, description }) => {
  assertSha256(expectedSha256, `${description} sha256`);
  const contents = await readFile(join(artifactDirectory, path));
  if (hashBytes(contents) !== expectedSha256) {
    throw new Error(`${description} bytes do not match provenance`);
  }
  return { contents, value: JSON.parse(contents.toString("utf8")) };
};

export const verifyMatrixArtifact = async (artifactDirectory) => {
  const resolvedDirectory = resolve(artifactDirectory);
  const provenance = assertObject(
    JSON.parse(await readFile(join(resolvedDirectory, "provenance.json"), "utf8")),
    "Matrix artifact provenance",
  );
  const provenanceKeys = [
    "schemaVersion",
    "evaluationId",
    "laneId",
    "status",
    "expectedProjectCount",
    "recordCount",
    "failedRecordCount",
    "artifact",
    "corpusManifest",
    "descriptorSha256",
    "impactManifestSha256",
    "rulesSha256",
    "baseArtifact",
    "ruleKeys",
    ...(Object.hasOwn(provenance, "evaluation") ? ["evaluation"] : []),
  ];
  assertExactKeys(provenance, provenanceKeys, "Matrix artifact provenance");
  if (
    provenance.schemaVersion !== 1 ||
    provenance.status !== "complete" ||
    !Number.isSafeInteger(provenance.expectedProjectCount) ||
    provenance.expectedProjectCount <= 0 ||
    provenance.recordCount !== provenance.expectedProjectCount ||
    provenance.failedRecordCount !== 0
  ) {
    throw new Error("Matrix artifact is not complete canonical evidence");
  }
  assertStringArray(provenance.ruleKeys, "Matrix provenance ruleKeys");
  const baseArtifact = assertObject(provenance.baseArtifact, "Matrix base artifact binding");
  const baseArtifactKeys = [
    "contract",
    "path",
    "sha256",
    "byteLength",
    "producer",
    "producerSha256",
    "verified",
    ...(Object.hasOwn(baseArtifact, "provenancePath") ? ["provenancePath"] : []),
    ...(Object.hasOwn(baseArtifact, "provenanceSha256") ? ["provenanceSha256"] : []),
  ];
  assertExactKeys(baseArtifact, baseArtifactKeys, "Matrix base artifact binding");
  if (
    baseArtifact.contract !== MATRIX_BASE_ARTIFACT_CONTRACT ||
    baseArtifact.verified !== true ||
    typeof baseArtifact.producerSha256 !== "string" ||
    baseArtifact.producerSha256 !== hashBytes(JSON.stringify(baseArtifact.producer))
  ) {
    throw new Error("Matrix base artifact binding is invalid");
  }
  assertProducer(baseArtifact.producer, "Matrix base artifact producer");
  const corpusManifest = assertObject(provenance.corpusManifest, "Matrix corpus manifest binding");
  const [
    { value: descriptor },
    { value: impactManifest },
    { contents: rulesContents, value: rules },
  ] = await Promise.all([
    loadBoundJson({
      artifactDirectory: resolvedDirectory,
      path: "descriptor.json",
      expectedSha256: provenance.descriptorSha256,
      description: "Matrix descriptor",
    }),
    loadBoundJson({
      artifactDirectory: resolvedDirectory,
      path: "impact-manifest.json",
      expectedSha256: provenance.impactManifestSha256,
      description: "Matrix impact manifest",
    }),
    loadBoundJson({
      artifactDirectory: resolvedDirectory,
      path: "rules.json",
      expectedSha256: provenance.rulesSha256,
      description: "Matrix rules",
    }),
  ]);
  assertExactKeys(descriptor, DESCRIPTOR_KEYS, "Matrix descriptor");
  assertExactKeys(descriptor.group, GROUP_KEYS, "Matrix descriptor group");
  assertExactKeys(impactManifest, IMPACT_MANIFEST_KEYS, "Matrix impact manifest");
  for (const [field, value] of [
    ["id", descriptor.id],
    ["artifactDirectory", descriptor.artifactDirectory],
    ["reactDoctorRepository", descriptor.reactDoctorRepository],
    ["impactManifestPath", descriptor.impactManifestPath],
  ]) {
    assertNonemptyString(value, `Matrix descriptor ${field}`);
  }
  assertCommit(descriptor.reactDoctorCommit, "Matrix descriptor reactDoctorCommit");
  assertCommit(descriptor.group.baseReactDoctorCommit, "Matrix descriptor baseReactDoctorCommit");
  for (const field of [
    "baseReactDoctorRepository",
    "baseArtifactPath",
    "baselineOutputPath",
    "baselineProvenancePath",
    "corpusManifestPath",
    "configContract",
    "scanContract",
    "reportContract",
    "projectRootPolicy",
  ]) {
    assertNonemptyString(descriptor.group[field], `Matrix descriptor group ${field}`);
  }
  for (const field of [
    "baseFullRuleSetHash",
    "corpusManifestSha256",
    "corpusProjectSetSha256",
    "evaluatorSourceHash",
  ]) {
    assertSha256(descriptor.group[field], `Matrix descriptor group ${field}`);
  }
  assertCommit(impactManifest.baseCommit, "Matrix impact baseCommit");
  assertCommit(impactManifest.headCommit, "Matrix impact headCommit");
  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.id !== provenance.laneId ||
    descriptor.impactManifestSha256 !== provenance.impactManifestSha256 ||
    descriptor.reactDoctorCommit !== impactManifest.headCommit ||
    descriptor.group.baseReactDoctorCommit !== impactManifest.baseCommit ||
    impactManifest.schemaVersion !== 1 ||
    (impactManifest.mode !== "incremental" && impactManifest.mode !== "full")
  ) {
    throw new Error("Matrix descriptor or impact manifest binding is invalid");
  }
  assertStringArray(impactManifest.candidateRuleKeys, "Matrix impact candidateRuleKeys");
  assertStringArray(impactManifest.changedPaths, "Matrix impact changedPaths");
  assertStringArray(impactManifest.runtimeChangedPaths, "Matrix impact runtimeChangedPaths");
  assertStringArray(impactManifest.impactedRuleKeys, "Matrix impact impactedRuleKeys");
  assertStringArray(impactManifest.fallbackReasons, "Matrix impact fallbackReasons");
  if (
    impactManifest.candidateRuleKeys.some((ruleKey) => !RULE_KEY_PATTERN.test(ruleKey)) ||
    impactManifest.impactedRuleKeys.some((ruleKey) => !RULE_KEY_PATTERN.test(ruleKey))
  ) {
    throw new Error("Matrix impact rule keys must be canonical");
  }
  if (!Array.isArray(impactManifest.rules)) {
    throw new Error("Matrix impact rules must be an array");
  }
  for (const rule of impactManifest.rules) {
    assertExactKeys(rule, ["ruleKey", "baseFingerprint", "headFingerprint"], "Matrix impact rule");
    if (
      typeof rule.ruleKey !== "string" ||
      !RULE_KEY_PATTERN.test(rule.ruleKey) ||
      (rule.baseFingerprint !== null &&
        (typeof rule.baseFingerprint !== "string" || !SHA256_PATTERN.test(rule.baseFingerprint))) ||
      (rule.headFingerprint !== null &&
        (typeof rule.headFingerprint !== "string" || !SHA256_PATTERN.test(rule.headFingerprint)))
    ) {
      throw new Error("Matrix impact rule is invalid");
    }
  }
  assertStringArray(rules, "Matrix rules");
  const canonicalRulesContents = `${JSON.stringify(rules, null, 2)}\n`;
  const expectedRuleKeys =
    impactManifest.mode === "incremental" ? impactManifest.candidateRuleKeys : [];
  if (
    rulesContents.toString("utf8") !== canonicalRulesContents ||
    JSON.stringify(rules) !== JSON.stringify(provenance.ruleKeys) ||
    JSON.stringify(rules) !== JSON.stringify(expectedRuleKeys)
  ) {
    throw new Error("Matrix rules do not match the bound candidate scope");
  }
  assertProducer(provenance.evaluation, "Matrix candidate producer");
  assertProducerMatches({
    producer: provenance.evaluation,
    expected: {
      reactDoctorRepository: descriptor.reactDoctorRepository,
      reactDoctorCommit: descriptor.reactDoctorCommit,
      configContract: descriptor.group.configContract,
      evaluatorSourceHash: descriptor.group.evaluatorSourceHash,
    },
    description: "Matrix candidate producer",
  });
  if (JSON.stringify(provenance.evaluation.ruleKeys) !== JSON.stringify(rules)) {
    throw new Error("Matrix candidate producer ruleKeys do not match the candidate scope");
  }
  assertProducerMatches({
    producer: baseArtifact.producer,
    expected: {
      reactDoctorRepository: descriptor.group.baseReactDoctorRepository,
      reactDoctorCommit: descriptor.group.baseReactDoctorCommit,
      configContract: descriptor.group.configContract,
      evaluatorSourceHash: descriptor.group.evaluatorSourceHash,
    },
    description: "Matrix base artifact producer",
  });
  if (
    (baseArtifact.producer.ruleKeys.length === 0 &&
      baseArtifact.producer.ruleSetHash !== descriptor.group.baseFullRuleSetHash) ||
    (baseArtifact.producer.ruleKeys.length > 0 &&
      rules.some((ruleKey) => !baseArtifact.producer.ruleKeys.includes(ruleKey)))
  ) {
    throw new Error("Matrix base artifact producer rule scope does not match the descriptor");
  }
  await Promise.all([
    assertFileBinding({
      artifactDirectory: resolvedDirectory,
      binding: provenance.artifact,
      expectedPath: "candidate.ndjson",
      description: "Matrix candidate artifact",
    }),
    assertFileBinding({
      artifactDirectory: resolvedDirectory,
      binding: {
        path: baseArtifact.path,
        sha256: baseArtifact.sha256,
        byteLength: baseArtifact.byteLength,
      },
      expectedPath: "base.ndjson",
      description: "Matrix base artifact",
    }),
    assertFileBinding({
      artifactDirectory: resolvedDirectory,
      binding: corpusManifest,
      expectedPath: "corpus-manifest.json",
      description: "Matrix corpus manifest",
    }),
  ]);
  if (corpusManifest.sha256 !== descriptor.group.corpusManifestSha256) {
    throw new Error("Matrix corpus manifest hash does not match the descriptor");
  }
  const corpusProjectKeys = await loadCorpusProjectKeys(
    join(resolvedDirectory, "corpus-manifest.json"),
  );
  if (
    corpusProjectKeys.size !== provenance.expectedProjectCount ||
    projectSetSha256(corpusProjectKeys) !== descriptor.group.corpusProjectSetSha256
  ) {
    throw new Error("Matrix corpus manifest count or project set does not match provenance");
  }
  const [candidateProjectKeys, baseProjectKeys] = await Promise.all([
    validateArtifactRun({
      filePath: join(resolvedDirectory, "candidate.ndjson"),
      description: "Matrix candidate artifact",
      expectedProjectCount: provenance.expectedProjectCount,
      expectedProjectSetSha256: descriptor.group.corpusProjectSetSha256,
      expectedProducer: provenance.evaluation,
    }),
    validateArtifactRun({
      filePath: join(resolvedDirectory, "base.ndjson"),
      description: "Matrix base artifact",
      expectedProjectCount: provenance.expectedProjectCount,
      expectedProjectSetSha256: descriptor.group.corpusProjectSetSha256,
      expectedProducer: baseArtifact.producer,
    }),
  ]);
  const expectedProjectKeys = [...corpusProjectKeys].sort();
  if (
    !isDeepStrictEqual([...candidateProjectKeys].sort(), expectedProjectKeys) ||
    !isDeepStrictEqual([...baseProjectKeys].sort(), expectedProjectKeys)
  ) {
    throw new Error("Matrix base or candidate project set does not match the corpus manifest");
  }
  if (baseArtifact.provenancePath !== undefined) {
    if (
      baseArtifact.provenancePath !== "base-provenance.json" ||
      typeof baseArtifact.provenanceSha256 !== "string" ||
      !SHA256_PATTERN.test(baseArtifact.provenanceSha256) ||
      (await hashFile(join(resolvedDirectory, baseArtifact.provenancePath))) !==
        baseArtifact.provenanceSha256
    ) {
      throw new Error("Matrix base provenance bytes do not match provenance");
    }
  } else if (baseArtifact.provenanceSha256 !== undefined) {
    throw new Error("Matrix base provenance binding is incomplete");
  }
  return provenance;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const artifactDirectory = process.argv[2];
  if (!artifactDirectory || process.argv.length !== 3) {
    process.stderr.write("Usage: verify-matrix-artifact.mjs <artifact-directory>\n");
    process.exitCode = 2;
  } else {
    verifyMatrixArtifact(artifactDirectory).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
