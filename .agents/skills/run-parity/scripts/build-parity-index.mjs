#!/usr/bin/env node

import { createHash } from "node:crypto";
import { resolve as resolveFileSystemPath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INVARIANT_DIAGNOSTIC_PLUGIN,
  INVARIANT_DIAGNOSTIC_RULE_KEYS,
  TYPESCRIPT_INVARIANT_RULE_SCOPE,
  compareStrings,
  coverageFingerprint,
  diagnosticCount,
  diagnosticRuleKey,
  diagnosticsByIdentity,
  loadSelectedRuleKeys,
  readRun,
} from "./compare-parity.mjs";

export const PARITY_INDEX_SCHEMA_VERSION = 1;
export const PARITY_INDEX_SEMANTIC_CONTRACT = "compare-parity@1";
export const PARITY_INDEX_HASH_ALGORITHM = "sha256";
const INVALID_INPUT_EXIT_CODE = 2;
const EXPECTED_ARGUMENT_COUNT = 3;
const CANDIDATE_ARGUMENT_COUNT = 4;
const JSON_INDENT_SPACES = 2;

export const semanticHash = (value) =>
  createHash(PARITY_INDEX_HASH_ALGORITHM).update(JSON.stringify(value)).digest("hex");

const indexRuleBucketKey = (ruleKey) =>
  ruleKey.startsWith(`${INVARIANT_DIAGNOSTIC_PLUGIN}/`) ? TYPESCRIPT_INVARIANT_RULE_SCOPE : ruleKey;

export const buildRuleBucketKeys = (selectedRuleKeys) =>
  [
    ...new Set([
      TYPESCRIPT_INVARIANT_RULE_SCOPE,
      ...INVARIANT_DIAGNOSTIC_RULE_KEYS,
      ...[...selectedRuleKeys].map(indexRuleBucketKey),
    ]),
  ].sort(compareStrings);

const buildProjectRuleBuckets = (diagnostics, ruleBucketKeys) => {
  const entriesByRule = new Map(ruleBucketKeys.map((ruleKey) => [ruleKey, []]));
  for (const [identity, occurrences] of diagnostics) {
    const canonicalDiagnostic = JSON.parse(identity);
    const ruleKey = indexRuleBucketKey(diagnosticRuleKey(canonicalDiagnostic));
    const entries = entriesByRule.get(ruleKey);
    if (!entries) {
      throw new Error(`Diagnostic cannot be assigned to the parity index scope: ${ruleKey}`);
    }
    entries.push([identity, occurrences.length]);
  }

  return ruleBucketKeys.map((ruleKey) => {
    const entries = entriesByRule
      .get(ruleKey)
      .sort((left, right) => compareStrings(left[0], right[0]));
    const bucketDiagnosticCount = entries.reduce(
      (total, [, occurrenceCount]) => total + occurrenceCount,
      0,
    );
    return {
      rule: ruleKey,
      diagnosticCount: bucketDiagnosticCount,
      semanticHash: semanticHash(entries),
    };
  });
};

export const buildParityIndex = async ({ inputPath, selectedRuleKeys, rejectOutsideRuleScope }) => {
  const ruleScope = [...selectedRuleKeys].sort(compareStrings);
  const ruleBucketKeys = buildRuleBucketKeys(selectedRuleKeys);
  const sourceHasher = createHash(PARITY_INDEX_HASH_ALGORITHM);
  const projects = [];
  const seenProjectKeys = new Set();

  const projectCount = await readRun(inputPath, (record, key, line) => {
    if (seenProjectKeys.has(key)) {
      throw new Error(`${inputPath} contains duplicate project ${key}`);
    }
    seenProjectKeys.add(key);
    sourceHasher.update(line);
    sourceHasher.update("\n");

    const indexedDiagnostics = diagnosticsByIdentity(
      record,
      rejectOutsideRuleScope,
      selectedRuleKeys,
    );
    if (indexedDiagnostics.error) {
      throw new Error(`${inputPath} project ${key}: ${indexedDiagnostics.error}`);
    }
    const projectCoverageFingerprint = coverageFingerprint(record);
    if (projectCoverageFingerprint === null) {
      throw new Error(`${inputPath} project ${key}: scoped parity index requires v3 coverage`);
    }
    projects.push({
      key,
      repository: record.repository,
      coverageHash: semanticHash(projectCoverageFingerprint),
      diagnosticCount: diagnosticCount(indexedDiagnostics.diagnostics),
      rules: buildProjectRuleBuckets(indexedDiagnostics.diagnostics, ruleBucketKeys),
    });
  });

  if (projectCount === 0) {
    throw new Error("Parity input must contain at least one eval record");
  }

  projects.sort((left, right) => compareStrings(left.key, right.key));
  const rules = ruleBucketKeys.map((ruleKey, ruleIndex) => {
    const projectBuckets = projects.map((project) => project.rules[ruleIndex]);
    return {
      rule: ruleKey,
      diagnosticCount: projectBuckets.reduce((total, bucket) => total + bucket.diagnosticCount, 0),
      semanticHash: semanticHash(
        projects.map((project, projectIndex) => [
          project.key,
          projectBuckets[projectIndex].diagnosticCount,
          projectBuckets[projectIndex].semanticHash,
        ]),
      ),
    };
  });
  const coverage = {
    projectCount,
    projectSetHash: semanticHash(projects.map((project) => project.key)),
    projectCoverageHash: semanticHash(
      projects.map((project) => [project.key, project.coverageHash]),
    ),
  };
  const invariantRuleScope = [
    TYPESCRIPT_INVARIANT_RULE_SCOPE,
    ...[...INVARIANT_DIAGNOSTIC_RULE_KEYS].sort(compareStrings),
  ];
  const runSemantics = {
    semanticContract: PARITY_INDEX_SEMANTIC_CONTRACT,
    ruleScope,
    invariantRuleScope,
    ruleBucketKeys,
    coverage,
    rules,
  };

  return {
    schemaVersion: PARITY_INDEX_SCHEMA_VERSION,
    hashAlgorithm: PARITY_INDEX_HASH_ALGORITHM,
    semanticContract: PARITY_INDEX_SEMANTIC_CONTRACT,
    sourceHash: sourceHasher.digest("hex"),
    ruleScope,
    invariantRuleScope,
    ruleBucketKeys,
    coverage,
    projects,
    rules,
    wholeRunHash: semanticHash(runSemantics),
  };
};

const runCli = async () => {
  const indexArguments = process.argv.slice(2);
  const rejectOutsideRuleScope =
    indexArguments.length === CANDIDATE_ARGUMENT_COUNT && indexArguments[0] === "--candidate";
  const scopedArguments = rejectOutsideRuleScope ? indexArguments.slice(1) : indexArguments;
  if (scopedArguments.length !== EXPECTED_ARGUMENT_COUNT || scopedArguments[0] !== "--rules") {
    process.stderr.write(
      "Usage: build-parity-index.mjs [--candidate] --rules <rules.json> <input.ndjson>\n",
    );
    process.exitCode = INVALID_INPUT_EXIT_CODE;
    return;
  }

  try {
    const selectedRuleKeys = loadSelectedRuleKeys(scopedArguments[1]);
    const index = await buildParityIndex({
      inputPath: scopedArguments[2],
      selectedRuleKeys,
      rejectOutsideRuleScope,
    });
    process.stdout.write(`${JSON.stringify(index, undefined, JSON_INDENT_SPACES)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = INVALID_INPUT_EXIT_CODE;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolveFileSystemPath(process.argv[1])) {
  await runCli();
}
