import { COMPARISON_REGRESSION_MIN_MS, COMPARISON_REGRESSION_RATIO } from "./constants.ts";
import type { BenchmarkComparison, BenchmarkComparisonSeries, BenchmarkSeries } from "./types.ts";

const seriesKey = (series: BenchmarkComparisonSeries): string =>
  [series.target.directory, series.mode, series.cacheCohort, String(series.workerCount)].join("::");

export const buildBenchmarkComparisons = (
  currentSeries: BenchmarkSeries[],
  baselineSeries: BenchmarkComparisonSeries[] | null,
): BenchmarkComparison[] => {
  if (baselineSeries === null) return [];
  const baselineByKey = new Map(baselineSeries.map((series) => [seriesKey(series), series]));
  return currentSeries.flatMap((series) => {
    const key = seriesKey(series);
    const baselineSeries = baselineByKey.get(key);
    if (baselineSeries === undefined) return [];
    if (baselineSeries.diagnosticHash !== series.diagnosticHash) {
      throw new Error(`Diagnostic output changed from the baseline for ${key}`);
    }
    const baselineMedianMilliseconds = baselineSeries.wallMilliseconds.median;
    const currentMedianMilliseconds = series.wallMilliseconds.median;
    const deltaMilliseconds = currentMedianMilliseconds - baselineMedianMilliseconds;
    const deltaRatio =
      baselineMedianMilliseconds === 0 ? 0 : deltaMilliseconds / baselineMedianMilliseconds;
    const isMaterial = Math.abs(deltaMilliseconds) >= COMPARISON_REGRESSION_MIN_MS;
    const classification =
      isMaterial && deltaRatio >= COMPARISON_REGRESSION_RATIO
        ? "regressed"
        : isMaterial && deltaRatio <= -COMPARISON_REGRESSION_RATIO
          ? "improved"
          : "stable";
    return [
      {
        key,
        baselineMedianMilliseconds,
        currentMedianMilliseconds,
        deltaMilliseconds,
        deltaRatio,
        classification,
      },
    ];
  });
};
