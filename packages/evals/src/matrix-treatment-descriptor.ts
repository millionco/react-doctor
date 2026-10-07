import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  EVALUATION_CONFIG_CONTRACT,
  EVALUATION_RULE_KEY_PATTERN,
  MATRIX_BASE_LANE_ID,
  MATRIX_DESCRIPTOR_ID_PATTERN,
  MATRIX_DESCRIPTOR_SCHEMA_VERSION,
  MATRIX_FULL_PARITY_RULE_KEYS,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
  PINNED_REPOSITORY_REF_PATTERN,
  SHA256_PATTERN,
} from "./constants.js";

export interface MatrixEvaluationGroup {
  baseReactDoctorRepository: string;
  baseReactDoctorCommit: string;
  baseFullRuleSetHash: string;
  baseArtifactPath: string;
  baselineOutputPath: string;
  baselineProvenancePath: string;
  corpusManifestPath: string;
  corpusManifestSha256: string;
  corpusProjectSetSha256: string;
  evaluatorSourceHash: string;
  configContract: string;
  scanContract: string;
  reportContract: string;
  projectRootPolicy: string;
}

export interface MatrixImpactManifest {
  schemaVersion: number;
  mode: "full" | "incremental";
  baseCommit: string;
  headCommit: string;
  changedPaths: ReadonlyArray<string>;
  runtimeChangedPaths: ReadonlyArray<string>;
  impactedRuleKeys: ReadonlyArray<string>;
  candidateRuleKeys: ReadonlyArray<string>;
  fallbackReasons: ReadonlyArray<string>;
  rules: ReadonlyArray<MatrixImpactRule>;
}

export interface MatrixImpactRule {
  ruleKey: string;
  baseFingerprint: string | null;
  headFingerprint: string | null;
}

export interface MatrixTreatmentDescriptor {
  schemaVersion: number;
  id: string;
  artifactDirectory: string;
  reactDoctorRepository: string;
  reactDoctorCommit: string;
  impactManifestPath: string;
  impactManifestSha256: string;
  group: MatrixEvaluationGroup;
}

export interface LoadedMatrixTreatment {
  descriptorPath: string;
  descriptorSha256: string;
  descriptorContents: string;
  descriptor: MatrixTreatmentDescriptor;
  impactManifestContents: string;
  impactManifest: MatrixImpactManifest;
  ruleKeys: ReadonlyArray<string>;
}

const hashContents = (contents: string | Buffer): string =>
  createHash("sha256").update(contents).digest("hex");

const assertObject = (value: unknown, description: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
};

const assertExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: ReadonlyArray<string>,
  description: string,
): void => {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    throw new Error(`${description} has unexpected fields`);
  }
};

const readString = (value: unknown, description: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a nonempty string`);
  }
  return value;
};

const readAbsolutePath = (value: unknown, description: string): string => {
  const path = readString(value, description);
  if (!isAbsolute(path)) throw new Error(`${description} must be an absolute path`);
  if (resolve(path) !== path) throw new Error(`${description} must be a normalized absolute path`);
  return path;
};

const readCommit = (value: unknown, description: string): string => {
  const commit = readString(value, description);
  if (!PINNED_REPOSITORY_REF_PATTERN.test(commit) || commit !== commit.toLowerCase()) {
    throw new Error(`${description} must be a lowercase 40-character commit`);
  }
  return commit;
};

const readSha256 = (value: unknown, description: string): string => {
  const digest = readString(value, description);
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`${description} must be a lowercase SHA-256 digest`);
  }
  return digest;
};

const readCanonicalStringArray = (
  value: unknown,
  description: string,
  pattern?: RegExp,
): ReadonlyArray<string> => {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        typeof entry !== "string" || entry.length === 0 || (pattern && !pattern.test(entry)),
    )
  ) {
    throw new Error(`${description} must contain canonical strings`);
  }
  const canonicalValues = [...new Set(value)].sort();
  if (JSON.stringify(value) !== JSON.stringify(canonicalValues)) {
    throw new Error(`${description} must be sorted and unique`);
  }
  return value;
};

const readFingerprint = (value: unknown, description: string): string | null => {
  if (value === null) return null;
  return readSha256(value, description);
};

const isPathInside = (candidatePath: string, parentPath: string): boolean => {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
};

const parseGroup = (value: unknown): MatrixEvaluationGroup => {
  const group = assertObject(value, "descriptor.group");
  assertExactKeys(
    group,
    [
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
    ],
    "descriptor.group",
  );
  const parsedGroup = {
    baseReactDoctorRepository: readString(
      group.baseReactDoctorRepository,
      "descriptor.group.baseReactDoctorRepository",
    ),
    baseReactDoctorCommit: readCommit(
      group.baseReactDoctorCommit,
      "descriptor.group.baseReactDoctorCommit",
    ),
    baseFullRuleSetHash: readSha256(
      group.baseFullRuleSetHash,
      "descriptor.group.baseFullRuleSetHash",
    ),
    baseArtifactPath: readAbsolutePath(group.baseArtifactPath, "descriptor.group.baseArtifactPath"),
    baselineOutputPath: readAbsolutePath(
      group.baselineOutputPath,
      "descriptor.group.baselineOutputPath",
    ),
    baselineProvenancePath: readAbsolutePath(
      group.baselineProvenancePath,
      "descriptor.group.baselineProvenancePath",
    ),
    corpusManifestPath: readAbsolutePath(
      group.corpusManifestPath,
      "descriptor.group.corpusManifestPath",
    ),
    corpusManifestSha256: readSha256(
      group.corpusManifestSha256,
      "descriptor.group.corpusManifestSha256",
    ),
    corpusProjectSetSha256: readSha256(
      group.corpusProjectSetSha256,
      "descriptor.group.corpusProjectSetSha256",
    ),
    evaluatorSourceHash: readSha256(
      group.evaluatorSourceHash,
      "descriptor.group.evaluatorSourceHash",
    ),
    configContract: readString(group.configContract, "descriptor.group.configContract"),
    scanContract: readString(group.scanContract, "descriptor.group.scanContract"),
    reportContract: readString(group.reportContract, "descriptor.group.reportContract"),
    projectRootPolicy: readString(group.projectRootPolicy, "descriptor.group.projectRootPolicy"),
  };
  if (parsedGroup.configContract !== EVALUATION_CONFIG_CONTRACT) {
    throw new Error("descriptor.group.configContract does not match this evaluator");
  }
  if (parsedGroup.scanContract !== MATRIX_SCAN_CONTRACT) {
    throw new Error("descriptor.group.scanContract does not match this evaluator");
  }
  if (parsedGroup.reportContract !== MATRIX_REPORT_CONTRACT) {
    throw new Error("descriptor.group.reportContract does not match this evaluator");
  }
  if (parsedGroup.projectRootPolicy !== MATRIX_PROJECT_ROOT_POLICY) {
    throw new Error("descriptor.group.projectRootPolicy does not match this evaluator");
  }
  return parsedGroup;
};

const parseDescriptor = (contents: string): MatrixTreatmentDescriptor => {
  const descriptor = assertObject(JSON.parse(contents), "descriptor");
  assertExactKeys(
    descriptor,
    [
      "schemaVersion",
      "id",
      "artifactDirectory",
      "reactDoctorRepository",
      "reactDoctorCommit",
      "impactManifestPath",
      "impactManifestSha256",
      "group",
    ],
    "descriptor",
  );
  if (descriptor.schemaVersion !== MATRIX_DESCRIPTOR_SCHEMA_VERSION) {
    throw new Error(`Unsupported matrix descriptor schema version: ${descriptor.schemaVersion}`);
  }
  const id = readString(descriptor.id, "descriptor.id");
  if (!MATRIX_DESCRIPTOR_ID_PATTERN.test(id)) {
    throw new Error("descriptor.id must contain only lowercase letters, numbers, and hyphens");
  }
  if (id === MATRIX_BASE_LANE_ID) {
    throw new Error(`descriptor.id cannot use the reserved matrix lane id: ${MATRIX_BASE_LANE_ID}`);
  }
  return {
    schemaVersion: MATRIX_DESCRIPTOR_SCHEMA_VERSION,
    id,
    artifactDirectory: readAbsolutePath(
      descriptor.artifactDirectory,
      "descriptor.artifactDirectory",
    ),
    reactDoctorRepository: readString(
      descriptor.reactDoctorRepository,
      "descriptor.reactDoctorRepository",
    ),
    reactDoctorCommit: readCommit(descriptor.reactDoctorCommit, "descriptor.reactDoctorCommit"),
    impactManifestPath: readAbsolutePath(
      descriptor.impactManifestPath,
      "descriptor.impactManifestPath",
    ),
    impactManifestSha256: readSha256(
      descriptor.impactManifestSha256,
      "descriptor.impactManifestSha256",
    ),
    group: parseGroup(descriptor.group),
  };
};

const parseImpactManifest = (
  contents: string,
  descriptor: MatrixTreatmentDescriptor,
): MatrixImpactManifest => {
  const manifest = assertObject(JSON.parse(contents), "impact manifest");
  assertExactKeys(
    manifest,
    [
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
    ],
    "impact manifest",
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported impact manifest schema version: ${manifest.schemaVersion}`);
  }
  if (manifest.mode !== "full" && manifest.mode !== "incremental") {
    throw new Error("impact manifest mode must be full or incremental");
  }
  const baseCommit = readCommit(manifest.baseCommit, "impact manifest baseCommit");
  const headCommit = readCommit(manifest.headCommit, "impact manifest headCommit");
  if (baseCommit !== descriptor.group.baseReactDoctorCommit) {
    throw new Error(`Impact manifest baseCommit does not match descriptor ${descriptor.id}`);
  }
  if (headCommit !== descriptor.reactDoctorCommit) {
    throw new Error(`Impact manifest headCommit does not match descriptor ${descriptor.id}`);
  }
  const changedPaths = readCanonicalStringArray(
    manifest.changedPaths,
    "impact manifest changedPaths",
  );
  const runtimeChangedPaths = readCanonicalStringArray(
    manifest.runtimeChangedPaths,
    "impact manifest runtimeChangedPaths",
  );
  if (runtimeChangedPaths.some((runtimePath) => !changedPaths.includes(runtimePath))) {
    throw new Error("impact manifest runtimeChangedPaths must be a subset of changedPaths");
  }
  const impactedRuleKeys = readCanonicalStringArray(
    manifest.impactedRuleKeys,
    "impact manifest impactedRuleKeys",
    EVALUATION_RULE_KEY_PATTERN,
  );
  const candidateRuleKeys = readCanonicalStringArray(
    manifest.candidateRuleKeys,
    "impact manifest candidateRuleKeys",
    EVALUATION_RULE_KEY_PATTERN,
  );
  const fallbackReasons = readCanonicalStringArray(
    manifest.fallbackReasons,
    "impact manifest fallbackReasons",
  );
  if (!Array.isArray(manifest.rules)) throw new Error("impact manifest rules must be an array");
  const rules = manifest.rules.map((ruleValue, ruleIndex): MatrixImpactRule => {
    const rule = assertObject(ruleValue, `impact manifest rules[${ruleIndex}]`);
    assertExactKeys(
      rule,
      ["ruleKey", "baseFingerprint", "headFingerprint"],
      `impact manifest rules[${ruleIndex}]`,
    );
    const ruleKey = readString(rule.ruleKey, `impact manifest rules[${ruleIndex}].ruleKey`);
    if (!EVALUATION_RULE_KEY_PATTERN.test(ruleKey)) {
      throw new Error(`impact manifest rules[${ruleIndex}].ruleKey must be canonical`);
    }
    return {
      ruleKey,
      baseFingerprint: readFingerprint(
        rule.baseFingerprint,
        `impact manifest rules[${ruleIndex}].baseFingerprint`,
      ),
      headFingerprint: readFingerprint(
        rule.headFingerprint,
        `impact manifest rules[${ruleIndex}].headFingerprint`,
      ),
    };
  });
  const ruleKeys = rules.map((rule) => rule.ruleKey);
  if (JSON.stringify(ruleKeys) !== JSON.stringify([...new Set(ruleKeys)].sort())) {
    throw new Error("impact manifest rules must be sorted and unique by ruleKey");
  }
  if (JSON.stringify(impactedRuleKeys) !== JSON.stringify(ruleKeys)) {
    throw new Error("impact manifest impactedRuleKeys must exactly match rules");
  }
  const expectedCandidateRuleKeys = rules
    .filter((rule) => !rule.ruleKey.startsWith("react-doctor/") || rule.headFingerprint !== null)
    .map((rule) => rule.ruleKey);
  const hasRemovedLocalRule = rules.some(
    (rule) =>
      rule.ruleKey.startsWith("react-doctor/") &&
      rule.baseFingerprint !== null &&
      rule.headFingerprint === null,
  );
  const hasFullParityRule = rules.some((rule) =>
    MATRIX_FULL_PARITY_RULE_KEYS.includes(rule.ruleKey),
  );
  if (
    (manifest.mode === "incremental" &&
      (runtimeChangedPaths.length === 0 ||
        candidateRuleKeys.length === 0 ||
        fallbackReasons.length !== 0 ||
        hasRemovedLocalRule ||
        hasFullParityRule ||
        JSON.stringify(candidateRuleKeys) !== JSON.stringify(expectedCandidateRuleKeys))) ||
    (manifest.mode === "full" && (candidateRuleKeys.length !== 0 || fallbackReasons.length === 0))
  ) {
    throw new Error(`Impact manifest ${manifest.mode} mode has invalid invariants`);
  }
  return {
    schemaVersion: 1,
    mode: manifest.mode,
    baseCommit,
    headCommit,
    changedPaths,
    runtimeChangedPaths,
    impactedRuleKeys,
    candidateRuleKeys,
    fallbackReasons,
    rules,
  };
};

export const loadMatrixTreatments = async (
  descriptorPaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<LoadedMatrixTreatment>> => {
  const treatments = await Promise.all(
    descriptorPaths.map(async (descriptorPath) => {
      if (!isAbsolute(descriptorPath)) {
        throw new Error("--matrix-treatment must be an absolute descriptor path");
      }
      const descriptorContents = await readFile(descriptorPath, "utf8");
      const descriptor = parseDescriptor(descriptorContents);
      const impactManifestContents = await readFile(descriptor.impactManifestPath, "utf8");
      if (hashContents(impactManifestContents) !== descriptor.impactManifestSha256) {
        throw new Error(`Impact manifest hash does not match descriptor ${descriptor.id}`);
      }
      const impactManifest = parseImpactManifest(impactManifestContents, descriptor);
      return {
        descriptorPath,
        descriptorSha256: hashContents(descriptorContents),
        descriptorContents,
        descriptor,
        impactManifestContents,
        impactManifest,
        ruleKeys: impactManifest.mode === "full" ? [] : impactManifest.candidateRuleKeys,
      };
    }),
  );
  const firstTreatment = treatments[0];
  if (!firstTreatment) throw new Error("Matrix evaluation requires at least one treatment");
  const expectedGroup = JSON.stringify(firstTreatment.descriptor.group);
  const treatmentIds = new Set<string>();
  const artifactDirectories = new Set<string>();
  for (const treatment of treatments) {
    if (JSON.stringify(treatment.descriptor.group) !== expectedGroup) {
      throw new Error(`Matrix treatment ${treatment.descriptor.id} has a different group contract`);
    }
    if (treatmentIds.has(treatment.descriptor.id)) {
      throw new Error(`Duplicate matrix treatment id: ${treatment.descriptor.id}`);
    }
    treatmentIds.add(treatment.descriptor.id);
    if (artifactDirectories.has(treatment.descriptor.artifactDirectory)) {
      throw new Error(
        `Duplicate matrix artifact directory: ${treatment.descriptor.artifactDirectory}`,
      );
    }
    artifactDirectories.add(treatment.descriptor.artifactDirectory);
  }
  const groupPaths = [
    firstTreatment.descriptor.group.baseArtifactPath,
    firstTreatment.descriptor.group.baselineOutputPath,
    firstTreatment.descriptor.group.baselineProvenancePath,
  ];
  if (new Set(groupPaths).size !== groupPaths.length) {
    throw new Error("Matrix base artifact and cache paths must be distinct");
  }
  const artifactDirectoryList = [...artifactDirectories];
  for (const [artifactIndex, artifactDirectory] of artifactDirectoryList.entries()) {
    for (const otherArtifactDirectory of artifactDirectoryList.slice(artifactIndex + 1)) {
      if (
        isPathInside(artifactDirectory, otherArtifactDirectory) ||
        isPathInside(otherArtifactDirectory, artifactDirectory)
      ) {
        throw new Error("Matrix treatment artifact directories cannot overlap");
      }
    }
    if (
      groupPaths.some(
        (groupPath) =>
          isPathInside(groupPath, artifactDirectory) || isPathInside(artifactDirectory, groupPath),
      )
    ) {
      throw new Error("Matrix group artifact paths cannot overlap treatment artifact directories");
    }
  }
  return treatments;
};

export const hashMatrixCorpusProjectSet = (
  repositories: ReadonlyArray<{ org: string; name: string; ref: string; rootDir: string }>,
): string => {
  const tuples = repositories
    .map((repository) => [repository.org, repository.name, repository.ref, repository.rootDir])
    .sort((leftTuple, rightTuple) => {
      const leftKey = JSON.stringify(leftTuple);
      const rightKey = JSON.stringify(rightTuple);
      if (leftKey === rightKey) return 0;
      return leftKey < rightKey ? -1 : 1;
    });
  return hashContents(JSON.stringify(tuples));
};
