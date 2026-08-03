#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolveFileSystemPath } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareStrings,
  coverageFingerprint,
  projectKey,
  readRun,
  validateReport,
} from "./compare-parity.mjs";

const PERFORMANCE_SCHEMA_VERSION = 1;
const PERFORMANCE_REGRESSION_EXIT_CODE = 1;
const INVALID_INPUT_EXIT_CODE = 2;
const EXPECTED_ARGUMENT_COUNT = 2;
const BASELINE_RECORD_FILE_SUFFIX = ".json";
const MINIMUM_BASELINE_ELAPSED_MS = 1_000;
const MINIMUM_PROJECT_REGRESSION_MS = 2_000;
const MAXIMUM_PROJECT_REGRESSION_RATIO = 1.5;
const MINIMUM_AGGREGATE_PROJECT_COUNT = 10;
const MINIMUM_AGGREGATE_REGRESSION_MS = 10_000;
const MAXIMUM_AGGREGATE_REGRESSION_RATIO = 1.2;
const PERCENTILE_SCALE = 100;
const MEDIAN_PERCENTILE = 50;
const TAIL_PERCENTILE = 95;
const DECIMAL_PLACES = 3;

const roundNumber = (value) => Number(value.toFixed(DECIMAL_PLACES));

const percentile = (values, percentileValue) => {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / PERCENTILE_SCALE) * sortedValues.length) - 1,
  );
  return roundNumber(sortedValues[index]);
};

const performanceRecord = (record, inputPath, key) => {
  if (Object.hasOwn(record, "error")) {
    throw new Error(`${inputPath} project ${key}: ${record.error}`);
  }
  const reportError = validateReport(record.report);
  if (reportError) throw new Error(`${inputPath} project ${key}: ${reportError}`);
  const projectCoverageFingerprint = coverageFingerprint(record);
  if (projectCoverageFingerprint === null) {
    throw new Error(`${inputPath} project ${key}: performance parity requires v3 coverage`);
  }
  const evaluation = record.evaluation;
  if (
    typeof evaluation !== "object" ||
    evaluation === null ||
    !Array.isArray(evaluation.ruleKeys) ||
    !evaluation.ruleKeys.every((ruleKey) => typeof ruleKey === "string") ||
    typeof evaluation.configContract !== "string" ||
    typeof evaluation.evaluatorSourceHash !== "string"
  ) {
    throw new Error(`${inputPath} project ${key}: performance parity requires eval provenance`);
  }
  return {
    repository: record.repository,
    elapsedMilliseconds: record.report.elapsedMilliseconds,
    coverageFingerprint: projectCoverageFingerprint,
    ruleKeys: [...evaluation.ruleKeys].sort(compareStrings),
    configContract: evaluation.configContract,
    evaluatorSourceHash: evaluation.evaluatorSourceHash,
  };
};

const baselineRecordPath = (temporaryDirectory, key) =>
  join(
    temporaryDirectory,
    `${createHash("sha256").update(key).digest("hex")}${BASELINE_RECORD_FILE_SUFFIX}`,
  );

const comparePerformance = async (baselinePath, candidatePath) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-performance-parity-"));
  const measurements = [];
  let baselineProjectCount;
  let candidateProjectCount;
  try {
    baselineProjectCount = await readRun(baselinePath, (record, key) => {
      const recordPath = baselineRecordPath(temporaryDirectory, key);
      if (existsSync(recordPath))
        throw new Error(`${baselinePath} contains duplicate project ${key}`);
      writeFileSync(recordPath, JSON.stringify(performanceRecord(record, baselinePath, key)));
    });
    const candidateKeys = new Set();
    candidateProjectCount = await readRun(candidatePath, (record, key) => {
      if (candidateKeys.has(key))
        throw new Error(`${candidatePath} contains duplicate project ${key}`);
      candidateKeys.add(key);
      const recordPath = baselineRecordPath(temporaryDirectory, key);
      if (!existsSync(recordPath))
        throw new Error(`${candidatePath} contains unexpected project ${key}`);
      const baseline = JSON.parse(readFileSync(recordPath, "utf8"));
      unlinkSync(recordPath);
      const candidate = performanceRecord(record, candidatePath, key);
      if (baseline.coverageFingerprint !== candidate.coverageFingerprint) {
        throw new Error(`${candidatePath} project ${key}: coverage differs from baseline`);
      }
      if (JSON.stringify(baseline.ruleKeys) !== JSON.stringify(candidate.ruleKeys)) {
        throw new Error(`${candidatePath} project ${key}: rule scope differs from baseline`);
      }
      if (baseline.configContract !== candidate.configContract) {
        throw new Error(`${candidatePath} project ${key}: config contract differs from baseline`);
      }
      if (baseline.evaluatorSourceHash !== candidate.evaluatorSourceHash) {
        throw new Error(`${candidatePath} project ${key}: evaluator source differs from baseline`);
      }
      const baselineElapsedMilliseconds = baseline.elapsedMilliseconds;
      const candidateElapsedMilliseconds = candidate.elapsedMilliseconds;
      const deltaMilliseconds = candidateElapsedMilliseconds - baselineElapsedMilliseconds;
      const ratio =
        baselineElapsedMilliseconds === 0
          ? null
          : candidateElapsedMilliseconds / baselineElapsedMilliseconds;
      const isEligible = baselineElapsedMilliseconds >= MINIMUM_BASELINE_ELAPSED_MS;
      const isRegression = Boolean(
        isEligible &&
        ratio !== null &&
        ratio >= MAXIMUM_PROJECT_REGRESSION_RATIO &&
        deltaMilliseconds >= MINIMUM_PROJECT_REGRESSION_MS,
      );
      measurements.push({
        repository: candidate.repository,
        baselineElapsedMilliseconds: roundNumber(baselineElapsedMilliseconds),
        candidateElapsedMilliseconds: roundNumber(candidateElapsedMilliseconds),
        deltaMilliseconds: roundNumber(deltaMilliseconds),
        ratio: ratio === null ? null : roundNumber(ratio),
        eligible: isEligible,
        regression: isRegression,
      });
    });
    if (baselineProjectCount === 0 || candidateProjectCount === 0) {
      throw new Error("Performance parity inputs must each contain at least one eval record");
    }
    const unmatchedBaselineFiles = readdirSync(temporaryDirectory).filter((fileName) =>
      fileName.endsWith(BASELINE_RECORD_FILE_SUFFIX),
    );
    if (unmatchedBaselineFiles.length > 0) {
      throw new Error(
        `${candidatePath} is missing ${unmatchedBaselineFiles.length} baseline project(s)`,
      );
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  measurements.sort((left, right) =>
    compareStrings(projectKey(left.repository), projectKey(right.repository)),
  );
  const eligibleMeasurements = measurements.filter((measurement) => measurement.eligible);
  const baselineElapsedMilliseconds = eligibleMeasurements.reduce(
    (total, measurement) => total + measurement.baselineElapsedMilliseconds,
    0,
  );
  const candidateElapsedMilliseconds = eligibleMeasurements.reduce(
    (total, measurement) => total + measurement.candidateElapsedMilliseconds,
    0,
  );
  const aggregateDeltaMilliseconds = candidateElapsedMilliseconds - baselineElapsedMilliseconds;
  const aggregateRatio =
    baselineElapsedMilliseconds === 0
      ? null
      : candidateElapsedMilliseconds / baselineElapsedMilliseconds;
  const isAggregateRegression = Boolean(
    eligibleMeasurements.length >= MINIMUM_AGGREGATE_PROJECT_COUNT &&
    aggregateRatio !== null &&
    aggregateRatio >= MAXIMUM_AGGREGATE_REGRESSION_RATIO &&
    aggregateDeltaMilliseconds >= MINIMUM_AGGREGATE_REGRESSION_MS,
  );
  const regressions = measurements.filter((measurement) => measurement.regression);
  const ratios = eligibleMeasurements.flatMap((measurement) =>
    measurement.ratio === null ? [] : [measurement.ratio],
  );
  const output = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    thresholds: {
      minimumBaselineElapsedMilliseconds: MINIMUM_BASELINE_ELAPSED_MS,
      minimumProjectRegressionMilliseconds: MINIMUM_PROJECT_REGRESSION_MS,
      maximumProjectRegressionRatio: MAXIMUM_PROJECT_REGRESSION_RATIO,
      minimumAggregateProjectCount: MINIMUM_AGGREGATE_PROJECT_COUNT,
      minimumAggregateRegressionMilliseconds: MINIMUM_AGGREGATE_REGRESSION_MS,
      maximumAggregateRegressionRatio: MAXIMUM_AGGREGATE_REGRESSION_RATIO,
    },
    summary: {
      baselineProjects: baselineProjectCount,
      candidateProjects: candidateProjectCount,
      comparedProjects: measurements.length,
      eligibleProjects: eligibleMeasurements.length,
      projectRegressions: regressions.length,
      aggregateRegression: isAggregateRegression,
      baselineElapsedMilliseconds: roundNumber(baselineElapsedMilliseconds),
      candidateElapsedMilliseconds: roundNumber(candidateElapsedMilliseconds),
      deltaMilliseconds: roundNumber(aggregateDeltaMilliseconds),
      ratio: aggregateRatio === null ? null : roundNumber(aggregateRatio),
      medianProjectRatio: percentile(ratios, MEDIAN_PERCENTILE),
      p95ProjectRatio: percentile(ratios, TAIL_PERCENTILE),
    },
    regressions,
    measurements,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.stderr.write(
    `Performance parity: ${regressions.length} project regression(s), aggregate ${isAggregateRegression ? "regression" : "within threshold"}\n`,
  );
  if (regressions.length > 0 || isAggregateRegression) {
    process.exitCode = PERFORMANCE_REGRESSION_EXIT_CODE;
  }
};

const runCli = async () => {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (process.argv.slice(2).length !== EXPECTED_ARGUMENT_COUNT || !baselinePath || !candidatePath) {
    process.stderr.write(
      "Usage: compare-parity-performance.mjs <baseline.ndjson> <candidate.ndjson>\n",
    );
    process.exitCode = INVALID_INPUT_EXIT_CODE;
    return;
  }
  try {
    await comparePerformance(baselinePath, candidatePath);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = INVALID_INPUT_EXIT_CODE;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolveFileSystemPath(process.argv[1])) {
  await runCli();
}
