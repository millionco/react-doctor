import * as path from "node:path";
import { COMPARISON_REGRESSION_MIN_MS, COMPARISON_REGRESSION_RATIO } from "./constants.ts";
import type { BenchmarkComparison, BenchmarkComparisonSeries, BenchmarkSeries } from "./types.ts";

const seriesKey = (series: BenchmarkComparisonSeries): string =>
  [
    series.target.targetId,
    series.target.label ?? path.basename(series.target.directory),
    String(series.target.sourceFileCount),
    String(series.target.sourceByteCount),
    series.target.sourceFingerprint,
    series.mode,
    series.cacheCohort,
    String(series.workerCount),
  ].join("::");

export const buildBenchmarkComparisons = (
  currentSeries: BenchmarkSeries[],
  baselineSeries: BenchmarkComparisonSeries[] | null,
): BenchmarkComparison[] => {
  if (baselineSeries === null) return [];
  const baselineByKey = new Map<string, BenchmarkComparisonSeries>();
  for (const series of baselineSeries) {
    const key = seriesKey(series);
    if (baselineByKey.has(key)) throw new Error(`Duplicate performance baseline series: ${key}`);
    baselineByKey.set(key, series);
  }
  const currentKeys = new Set<string>();
  const comparisons: BenchmarkComparison[] = [];
  for (const series of currentSeries) {
    const key = seriesKey(series);
    if (currentKeys.has(key)) throw new Error(`Duplicate current performance series: ${key}`);
    currentKeys.add(key);
    const matchingBaseline = baselineByKey.get(key);
    if (matchingBaseline === undefined) {
      throw new Error(`Performance baseline has no matching series for ${key}`);
    }
    if (matchingBaseline.diagnosticHash !== series.diagnosticHash) {
      throw new Error(`Diagnostic output changed from the baseline for ${key}`);
    }
    const baselineMedianMilliseconds = matchingBaseline.wallMilliseconds.median;
    const currentMedianMilliseconds = series.wallMilliseconds.median;
    const deltaMilliseconds = currentMedianMilliseconds - baselineMedianMilliseconds;
    const deltaRatio =
      baselineMedianMilliseconds === 0 ? 0 : deltaMilliseconds / baselineMedianMilliseconds;
    const isMaterial = Math.abs(deltaMilliseconds) >= COMPARISON_REGRESSION_MIN_MS;
    let classification: BenchmarkComparison["classification"] = "stable";
    if (isMaterial && deltaRatio >= COMPARISON_REGRESSION_RATIO) {
      classification = "regressed";
    } else if (isMaterial && deltaRatio <= -COMPARISON_REGRESSION_RATIO) {
      classification = "improved";
    }
    comparisons.push({
      key,
      baselineMedianMilliseconds,
      currentMedianMilliseconds,
      deltaMilliseconds,
      deltaRatio,
      classification,
    });
  }
  return comparisons;
};
