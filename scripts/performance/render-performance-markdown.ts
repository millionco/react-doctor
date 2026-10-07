import {
  BYTES_PER_MEBIBYTE,
  MICROSECONDS_PER_SECOND,
  PERCENT_MULTIPLIER,
  RESULTS_TOP_RULE_COUNT,
  RESULTS_TOP_SELECTOR_COUNT,
} from "./constants.ts";
import type {
  BenchmarkComparison,
  BenchmarkSeries,
  CpuProfileSummary,
  PerformanceResult,
  RuleTimingSummary,
} from "./types.ts";
import { shortenProfileUrl } from "./summarize-cpu-profiles.ts";

const formatMilliseconds = (value: number): string => `${value.toFixed(1)} ms`;
const formatSeconds = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `${value.toFixed(2)} s`;
const formatMebibytes = (value: number | null): string =>
  value === null ? "n/a" : `${(value / BYTES_PER_MEBIBYTE).toFixed(1)} MiB`;
const formatPercent = (value: number): string => `${value.toFixed(1)}%`;
const escapeCell = (value: string): string => value.replaceAll("|", "\\|");

const seriesTitle = (series: BenchmarkSeries): string =>
  `${series.target.label} (${series.mode}/${series.cacheCohort}/workers=${series.workerCount})`;

const renderTimelineTable = (seriesList: readonly BenchmarkSeries[]): string[] => {
  const seriesWithTimeline = seriesList.filter(
    (series) => series.timeline !== null && series.timeline !== undefined,
  );
  if (seriesWithTimeline.length === 0) return [];
  const lines = [
    "",
    "## Scan timeline (median sample)",
    "",
    "| Target | Mode | Cache | Workers | Wall | User CPU | Sys CPU | Parent user/sys | oxlint procs | Failed | Configs | Child files | Σ child | Child median/max | Avg conc. | Peak conc. | Head | Tail |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const series of seriesWithTimeline) {
    const timeline = series.timeline;
    if (timeline === null || timeline === undefined) continue;
    lines.push(
      `| ${series.target.label} | ${series.mode} | ${series.cacheCohort} | ${series.workerCount} | ${formatMilliseconds(timeline.wallMilliseconds)} | ${formatSeconds(series.userSeconds?.median)} | ${formatSeconds(series.systemSeconds?.median)} | ${formatSeconds(timeline.parentUserSeconds)} / ${formatSeconds(timeline.parentSystemSeconds)} | ${timeline.childProcessCount} | ${timeline.failedChildProcessCount} | ${timeline.configCount} | ${timeline.childFileCount} | ${formatMilliseconds(timeline.childDurationSumMilliseconds)} | ${formatMilliseconds(timeline.childDurationMedianMilliseconds)} / ${formatMilliseconds(timeline.childDurationMaximumMilliseconds)} | ${timeline.averageConcurrency.toFixed(2)} | ${timeline.peakConcurrency} | ${formatMilliseconds(timeline.headMilliseconds)} | ${formatMilliseconds(timeline.tailMilliseconds)} |`,
    );
  }
  return lines;
};

const renderRuleTimings = (series: BenchmarkSeries, summary: RuleTimingSummary): string[] => {
  const lines = [
    "",
    `## Rule timings: ${seriesTitle(series)}`,
    "",
    `Processes: ${summary.processCount}; total rule time: ${formatMilliseconds(summary.totalMilliseconds)}; \`<create>\`: ${formatMilliseconds(summary.createMilliseconds)} (${formatPercent(summary.totalMilliseconds === 0 ? 0 : (summary.createMilliseconds / summary.totalMilliseconds) * PERCENT_MULTIPLIER)})`,
    "",
    "| Rule | Total | % | Calls | `<create>` | Top selector |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const row of summary.rules.slice(0, RESULTS_TOP_RULE_COUNT)) {
    lines.push(
      `| ${escapeCell(row.rule)} | ${formatMilliseconds(row.totalMilliseconds)} | ${formatPercent(row.percentOfTotal)} | ${row.calls} | ${formatMilliseconds(row.createMilliseconds)} | ${escapeCell(row.topSelector)} |`,
    );
  }
  lines.push(
    "",
    "### By selector",
    "",
    "| Selector | Total | % | Calls | Rules | Top rule |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  );
  for (const row of summary.selectors.slice(0, RESULTS_TOP_SELECTOR_COUNT)) {
    lines.push(
      `| ${escapeCell(row.selector)} | ${formatMilliseconds(row.totalMilliseconds)} | ${formatPercent(row.percentOfTotal)} | ${row.calls} | ${row.ruleCount} | ${escapeCell(row.topRule)} |`,
    );
  }
  return lines;
};

const renderCpuProfile = (series: BenchmarkSeries, summary: CpuProfileSummary): string[] => {
  const lines = [
    "",
    `## Child CPU profiles: ${seriesTitle(series)}`,
    "",
    `Processes: ${summary.processCount}; sampled: ${(summary.sampledMicroseconds / MICROSECONDS_PER_SECOND).toFixed(2)} s`,
    "",
    "| Category | Self | Frames |",
    "| --- | ---: | ---: |",
  ];
  for (const category of summary.categories) {
    lines.push(
      `| ${escapeCell(category.source)} | ${formatPercent(category.selfPercent)} | ${category.frameCount} |`,
    );
  }
  lines.push(
    "",
    "### Self time by function",
    "",
    "| Function | Source | Self | Total |",
    "| --- | --- | ---: | ---: |",
  );
  for (const frame of summary.functions) {
    const source = frame.url ? `${shortenProfileUrl(frame.url)}:${frame.lineNumber}` : "(native)";
    lines.push(
      `| ${escapeCell(frame.functionName)} | ${escapeCell(source)} | ${formatPercent(frame.selfPercent)} | ${formatPercent(frame.totalPercent)} |`,
    );
  }
  lines.push(
    "",
    "### Self time by source URL",
    "",
    "| Source | Self | Frames |",
    "| --- | ---: | ---: |",
  );
  for (const source of summary.sources) {
    lines.push(
      `| ${escapeCell(source.source)} | ${formatPercent(source.selfPercent)} | ${source.frameCount} |`,
    );
  }
  return lines;
};

const renderComparisons = (comparisons: readonly BenchmarkComparison[]): string[] => {
  if (comparisons.length === 0) return [];
  const lines = ["", "## Comparison", ""];
  const mismatches = comparisons.filter((comparison) => !comparison.diagnosticsMatch);
  if (mismatches.length > 0) {
    lines.push(
      `> **DIAGNOSTICS MISMATCH**: ${mismatches.length} series no longer produce the baseline diagnostics. Speedups for those rows are not trustworthy.`,
      "",
    );
  }
  lines.push(
    "| Series | Baseline | Current | Delta | Speedup | Diagnostics | Result |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  );
  for (const comparison of comparisons) {
    lines.push(
      `| ${escapeCell(comparison.key)} | ${formatMilliseconds(comparison.baselineMedianMilliseconds)} | ${formatMilliseconds(comparison.currentMedianMilliseconds)} | ${(comparison.deltaRatio * PERCENT_MULTIPLIER).toFixed(1)}% | ${comparison.speedupRatio.toFixed(2)}x | ${comparison.diagnosticsMatch ? "identical" : "MISMATCH"} | ${comparison.classification} |`,
    );
  }
  return lines;
};

export const renderPerformanceMarkdown = (result: PerformanceResult): string => {
  const lines = [
    "# React Doctor performance results",
    "",
    `Generated: ${result.generatedAt}`,
    `React Doctor: ${result.reactDoctorGitSha ?? "unknown"}${result.reactDoctorIsDirty ? " (dirty)" : ""}`,
    `Host: ${result.host.cpuModel}, ${result.host.cpuCount} CPUs, Node ${result.host.nodeVersion}, ${result.host.platform}-${result.host.architecture}`,
    `CLI: ${result.options.cliPath}`,
    "",
    "| Target | Mode | Cache | Workers | Samples | Wall median | MAD | Range | User CPU | Peak RSS | Files/s | MiB/s | Diagnostics |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const series of result.series) {
    const residentSetMedian = series.maximumResidentSetBytes?.median ?? null;
    lines.push(
      `| ${series.target.label} | ${series.mode} | ${series.cacheCohort} | ${series.workerCount} | ${series.samples.length} | ${formatMilliseconds(series.wallMilliseconds.median)} | ${formatMilliseconds(series.wallMilliseconds.medianAbsoluteDeviation)} | ${formatMilliseconds(series.wallMilliseconds.minimum)}–${formatMilliseconds(series.wallMilliseconds.maximum)} | ${formatSeconds(series.userSeconds?.median)} | ${formatMebibytes(residentSetMedian)} | ${series.filesPerSecond.toFixed(1)} | ${series.mebibytesPerSecond.toFixed(1)} | ${series.samples[0]?.diagnosticCount ?? "n/a"} (${series.diagnosticHash.slice(0, 12)}) |`,
    );
  }
  lines.push(...renderTimelineTable(result.series), ...renderComparisons(result.comparisons));
  for (const series of result.series) {
    if (series.ruleTimings) lines.push(...renderRuleTimings(series, series.ruleTimings));
    if (series.cpuProfile) lines.push(...renderCpuProfile(series, series.cpuProfile));
  }
  return `${lines.join("\n")}\n`;
};
