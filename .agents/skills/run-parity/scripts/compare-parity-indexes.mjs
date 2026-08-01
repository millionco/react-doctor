#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve as resolveFileSystemPath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARITY_INDEX_HASH_ALGORITHM,
  PARITY_INDEX_SCHEMA_VERSION,
  PARITY_INDEX_SEMANTIC_CONTRACT,
  buildRuleBucketKeys,
  semanticHash,
} from "./build-parity-index.mjs";
import {
  INVARIANT_DIAGNOSTIC_RULE_KEYS,
  TYPESCRIPT_INVARIANT_RULE_SCOPE,
  compareStrings,
  projectKey,
  validateEvalRecord,
} from "./compare-parity.mjs";

const PARITY_DIFFERENCE_EXIT_CODE = 1;
const INVALID_INPUT_EXIT_CODE = 2;
const EXPECTED_ARGUMENT_COUNT = 2;
const JSON_INDENT_SPACES = 2;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RULE_SCOPE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9-]*$/;
const RULE_BUCKET_KEY_PATTERN = /^(?:TS\/\*|[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9-]*)$/;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isHash = (value) => typeof value === "string" && HASH_PATTERN.test(value);
const isNonnegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const hasCanonicalOrder = (values) =>
  values.every((value, valueIndex) => valueIndex === 0 || values[valueIndex - 1] < value);

const validateRuleSummary = (ruleSummary, expectedRuleKey) =>
  isRecord(ruleSummary) &&
  ruleSummary.rule === expectedRuleKey &&
  isNonnegativeInteger(ruleSummary.diagnosticCount) &&
  isHash(ruleSummary.semanticHash);

export const validateParityIndex = (index) => {
  if (
    !isRecord(index) ||
    index.schemaVersion !== PARITY_INDEX_SCHEMA_VERSION ||
    index.hashAlgorithm !== PARITY_INDEX_HASH_ALGORITHM ||
    index.semanticContract !== PARITY_INDEX_SEMANTIC_CONTRACT ||
    !isHash(index.sourceHash) ||
    !Array.isArray(index.ruleScope) ||
    index.ruleScope.length === 0 ||
    !index.ruleScope.every(
      (ruleKey) => typeof ruleKey === "string" && RULE_SCOPE_KEY_PATTERN.test(ruleKey),
    ) ||
    !hasCanonicalOrder(index.ruleScope) ||
    !Array.isArray(index.invariantRuleScope) ||
    !Array.isArray(index.ruleBucketKeys) ||
    !index.ruleBucketKeys.every(
      (ruleKey) => typeof ruleKey === "string" && RULE_BUCKET_KEY_PATTERN.test(ruleKey),
    ) ||
    !hasCanonicalOrder(index.ruleBucketKeys) ||
    !isRecord(index.coverage) ||
    !Array.isArray(index.projects) ||
    !Array.isArray(index.rules) ||
    !isHash(index.wholeRunHash)
  ) {
    return "Invalid parity index schema";
  }

  const expectedInvariantRuleScope = [
    TYPESCRIPT_INVARIANT_RULE_SCOPE,
    ...[...INVARIANT_DIAGNOSTIC_RULE_KEYS].sort(compareStrings),
  ];
  const expectedRuleBucketKeys = buildRuleBucketKeys(new Set(index.ruleScope));
  if (
    JSON.stringify(index.invariantRuleScope) !== JSON.stringify(expectedInvariantRuleScope) ||
    JSON.stringify(index.ruleBucketKeys) !== JSON.stringify(expectedRuleBucketKeys)
  ) {
    return "Parity index rule scope metadata is inconsistent";
  }
  if (
    index.coverage.projectCount !== index.projects.length ||
    index.projects.length === 0 ||
    !isHash(index.coverage.projectSetHash) ||
    !isHash(index.coverage.projectCoverageHash) ||
    index.rules.length !== index.ruleBucketKeys.length
  ) {
    return "Parity index coverage or rule count is inconsistent";
  }

  const projectKeys = [];
  const seenProjectKeys = new Set();
  for (const project of index.projects) {
    if (
      !isRecord(project) ||
      typeof project.key !== "string" ||
      !isRecord(project.repository) ||
      !validateEvalRecord({ schemaVersion: 1, repository: project.repository }) ||
      project.key !== projectKey(project.repository) ||
      seenProjectKeys.has(project.key) ||
      (project.coverageHash !== null && !isHash(project.coverageHash)) ||
      !isNonnegativeInteger(project.diagnosticCount) ||
      !Array.isArray(project.rules) ||
      project.rules.length !== index.ruleBucketKeys.length
    ) {
      return "Invalid parity index project";
    }
    seenProjectKeys.add(project.key);
    projectKeys.push(project.key);
    let projectDiagnosticCount = 0;
    for (const [ruleIndex, ruleBucket] of project.rules.entries()) {
      if (!validateRuleSummary(ruleBucket, index.ruleBucketKeys[ruleIndex])) {
        return "Invalid parity index project rule bucket";
      }
      projectDiagnosticCount += ruleBucket.diagnosticCount;
    }
    if (projectDiagnosticCount !== project.diagnosticCount) {
      return "Parity index project diagnostic count is inconsistent";
    }
  }
  if (!hasCanonicalOrder(projectKeys)) {
    return "Parity index projects are not in canonical order";
  }
  if (
    index.coverage.projectSetHash !== semanticHash(projectKeys) ||
    index.coverage.projectCoverageHash !==
      semanticHash(index.projects.map((project) => [project.key, project.coverageHash]))
  ) {
    return "Parity index coverage hashes are inconsistent";
  }

  for (const [ruleIndex, ruleSummary] of index.rules.entries()) {
    const ruleKey = index.ruleBucketKeys[ruleIndex];
    if (!validateRuleSummary(ruleSummary, ruleKey)) {
      return "Invalid parity index rule summary";
    }
    const projectBuckets = index.projects.map((project) => project.rules[ruleIndex]);
    const diagnosticCount = projectBuckets.reduce(
      (total, bucket) => total + bucket.diagnosticCount,
      0,
    );
    const aggregateHash = semanticHash(
      index.projects.map((project, projectIndex) => [
        project.key,
        projectBuckets[projectIndex].diagnosticCount,
        projectBuckets[projectIndex].semanticHash,
      ]),
    );
    if (
      ruleSummary.diagnosticCount !== diagnosticCount ||
      ruleSummary.semanticHash !== aggregateHash
    ) {
      return "Parity index rule aggregate is inconsistent";
    }
  }

  const runSemantics = {
    semanticContract: index.semanticContract,
    ruleScope: index.ruleScope,
    invariantRuleScope: index.invariantRuleScope,
    ruleBucketKeys: index.ruleBucketKeys,
    coverage: index.coverage,
    rules: index.rules,
  };
  if (index.wholeRunHash !== semanticHash(runSemantics)) {
    return "Parity index whole-run hash is inconsistent";
  }
  return null;
};

const compareMetadata = (baselineIndex, candidateIndex) => {
  const mismatches = [];
  if (baselineIndex.semanticContract !== candidateIndex.semanticContract) {
    mismatches.push("Semantic contracts differ");
  }
  if (JSON.stringify(baselineIndex.ruleScope) !== JSON.stringify(candidateIndex.ruleScope)) {
    mismatches.push("Requested rule scopes differ");
  }
  if (
    JSON.stringify(baselineIndex.invariantRuleScope) !==
    JSON.stringify(candidateIndex.invariantRuleScope)
  ) {
    mismatches.push("Invariant rule scopes differ");
  }
  if (
    JSON.stringify(baselineIndex.ruleBucketKeys) !== JSON.stringify(candidateIndex.ruleBucketKeys)
  ) {
    mismatches.push("Rule bucket scopes differ");
  }
  if (baselineIndex.coverage.projectSetHash !== candidateIndex.coverage.projectSetHash) {
    mismatches.push("Project sets differ");
    return mismatches;
  }
  for (const [projectIndex, baselineProject] of baselineIndex.projects.entries()) {
    const candidateProject = candidateIndex.projects[projectIndex];
    if (baselineProject.key !== candidateProject.key) {
      mismatches.push("Project ordering differs");
      break;
    }
    if (baselineProject.coverageHash !== candidateProject.coverageHash) {
      mismatches.push(`Project coverage differs: ${baselineProject.key}`);
    }
  }
  return mismatches;
};

export const compareParityIndexes = (baselineIndex, candidateIndex) => {
  const baselineError = validateParityIndex(baselineIndex);
  const candidateError = validateParityIndex(candidateIndex);
  if (baselineError || candidateError) {
    return {
      valid: false,
      baselineError,
      candidateError,
      metadataMismatches: [],
    };
  }

  const metadataMismatches = compareMetadata(baselineIndex, candidateIndex);
  if (metadataMismatches.length > 0) {
    return {
      valid: false,
      baselineError: null,
      candidateError: null,
      metadataMismatches,
    };
  }

  if (baselineIndex.wholeRunHash === candidateIndex.wholeRunHash) {
    return {
      valid: true,
      match: true,
      baselineWholeRunHash: baselineIndex.wholeRunHash,
      candidateWholeRunHash: candidateIndex.wholeRunHash,
      summary: {
        comparedProjects: baselineIndex.projects.length,
        comparedRules: baselineIndex.rules.length,
        ruleHashesChecked: 0,
        projectRuleHashesChecked: 0,
        changedRules: 0,
        changedProjectRuleBuckets: 0,
      },
      changedRules: [],
    };
  }

  const changedRules = [];
  let changedProjectRuleBucketCount = 0;
  let projectRuleHashCheckCount = 0;
  for (const [ruleIndex, baselineRule] of baselineIndex.rules.entries()) {
    const candidateRule = candidateIndex.rules[ruleIndex];
    if (baselineRule.semanticHash === candidateRule.semanticHash) continue;

    const changedProjects = [];
    for (const [projectIndex, baselineProject] of baselineIndex.projects.entries()) {
      projectRuleHashCheckCount += 1;
      const baselineBucket = baselineProject.rules[ruleIndex];
      const candidateProject = candidateIndex.projects[projectIndex];
      const candidateBucket = candidateProject.rules[ruleIndex];
      if (baselineBucket.semanticHash === candidateBucket.semanticHash) continue;
      changedProjects.push({
        repository: baselineProject.repository,
        baselineDiagnostics: baselineBucket.diagnosticCount,
        candidateDiagnostics: candidateBucket.diagnosticCount,
        baselineHash: baselineBucket.semanticHash,
        candidateHash: candidateBucket.semanticHash,
      });
    }
    changedProjectRuleBucketCount += changedProjects.length;
    changedRules.push({
      rule: baselineRule.rule,
      baselineDiagnostics: baselineRule.diagnosticCount,
      candidateDiagnostics: candidateRule.diagnosticCount,
      baselineHash: baselineRule.semanticHash,
      candidateHash: candidateRule.semanticHash,
      changedProjects,
    });
  }

  return {
    valid: true,
    match: changedRules.length === 0,
    baselineWholeRunHash: baselineIndex.wholeRunHash,
    candidateWholeRunHash: candidateIndex.wholeRunHash,
    summary: {
      comparedProjects: baselineIndex.projects.length,
      comparedRules: baselineIndex.rules.length,
      ruleHashesChecked: baselineIndex.rules.length,
      projectRuleHashesChecked: projectRuleHashCheckCount,
      changedRules: changedRules.length,
      changedProjectRuleBuckets: changedProjectRuleBucketCount,
    },
    changedRules,
  };
};

const readIndex = (indexPath) => {
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    throw new Error(`${indexPath} is not valid JSON`);
  }
};

const runCli = () => {
  const comparisonArguments = process.argv.slice(2);
  if (comparisonArguments.length !== EXPECTED_ARGUMENT_COUNT) {
    process.stderr.write(
      "Usage: compare-parity-indexes.mjs <baseline.index.json> <candidate.index.json>\n",
    );
    process.exitCode = INVALID_INPUT_EXIT_CODE;
    return;
  }

  try {
    const comparison = compareParityIndexes(
      readIndex(comparisonArguments[0]),
      readIndex(comparisonArguments[1]),
    );
    process.stdout.write(`${JSON.stringify(comparison, undefined, JSON_INDENT_SPACES)}\n`);
    if (!comparison.valid) {
      process.exitCode = INVALID_INPUT_EXIT_CODE;
    } else if (!comparison.match) {
      process.exitCode = PARITY_DIFFERENCE_EXIT_CODE;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = INVALID_INPUT_EXIT_CODE;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolveFileSystemPath(process.argv[1])) {
  runCli();
}
