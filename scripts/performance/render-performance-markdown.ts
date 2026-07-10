import { BYTES_PER_MEBIBYTE, PERCENT_MULTIPLIER } from "./constants.ts";
import type { PerformanceResult } from "./types.ts";

const formatMilliseconds = (value: number): string => `${value.toFixed(1)} ms`;
const formatMebibytes = (value: number | null): string =>
  value === null ? "n/a" : `${(value / BYTES_PER_MEBIBYTE).toFixed(1)} MiB`;

export const renderPerformanceMarkdown = (result: PerformanceResult): string => {
  const lines = [
    "# React Doctor performance results",
    "",
    `Generated: ${result.generatedAt}`,
    `React Doctor: ${result.reactDoctorGitSha ?? "unknown"}${result.reactDoctorIsDirty ? " (dirty)" : ""}`,
    `Host: ${result.host.cpuModel}, ${result.host.cpuCount} CPUs, Node ${result.host.nodeVersion}, ${result.host.platform}-${result.host.architecture}`,
    "",
    "| Target | Mode | Cache | Workers | Samples | Wall median | MAD | Range | Peak RSS | Files/s | MiB/s |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const series of result.series) {
    const residentSetMedian = series.maximumResidentSetBytes?.median ?? null;
    lines.push(
      `| ${series.target.label} | ${series.mode} | ${series.cacheCohort} | ${series.workerCount} | ${series.samples.length} | ${formatMilliseconds(series.wallMilliseconds.median)} | ${formatMilliseconds(series.wallMilliseconds.medianAbsoluteDeviation)} | ${formatMilliseconds(series.wallMilliseconds.minimum)}–${formatMilliseconds(series.wallMilliseconds.maximum)} | ${formatMebibytes(residentSetMedian)} | ${series.filesPerSecond.toFixed(1)} | ${series.mebibytesPerSecond.toFixed(1)} |`,
    );
  }
  if (result.comparisons.length > 0) {
    lines.push(
      "",
      "## Comparison",
      "",
      "| Series | Baseline | Current | Delta | Result |",
      "| --- | ---: | ---: | ---: | --- |",
    );
    for (const comparison of result.comparisons) {
      lines.push(
        `| ${comparison.key} | ${formatMilliseconds(comparison.baselineMedianMilliseconds)} | ${formatMilliseconds(comparison.currentMedianMilliseconds)} | ${(comparison.deltaRatio * PERCENT_MULTIPLIER).toFixed(1)}% | ${comparison.classification} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
};
