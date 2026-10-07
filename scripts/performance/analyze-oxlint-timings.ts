import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PERCENT_MULTIPLIER, PROFILE_TOP_RULE_COUNT } from "./constants.ts";
import { parseOxlintTimingOutput } from "./parse-oxlint-timing-output.ts";
import { parseRulePerformanceTimings } from "./parse-rule-performance-timings.ts";
import { collectProfilePaths } from "./profile-frames.ts";
import { runProfileAnalysisMain } from "./run-commander-main.ts";
import type {
  OxlintRuleTiming,
  OxlintTimingAnalysis,
  OxlintTimingProcessSummary,
} from "./types.ts";

interface MutableRuleTiming {
  rule: string;
  timeMilliseconds: number;
  calls: number;
  source: string;
}

const analyzeTimingFile = (timingPath: string): OxlintTimingProcessSummary => {
  const timingOutput = fs.readFileSync(timingPath, "utf8");
  const rules = timingPath.endsWith(".json")
    ? parseRulePerformanceTimings(timingOutput)
    : parseOxlintTimingOutput(timingOutput);
  return {
    file: timingPath,
    totalTimeMilliseconds: rules.reduce(
      (totalMilliseconds, rule) => totalMilliseconds + rule.timeMilliseconds,
      0,
    ),
    rules,
  };
};

const aggregateRuleTimings = (
  processes: readonly OxlintTimingProcessSummary[],
): OxlintRuleTiming[] => {
  const timingsByRule = new Map<string, MutableRuleTiming>();
  for (const processSummary of processes) {
    for (const ruleTiming of processSummary.rules) {
      const key = `${ruleTiming.source}\0${ruleTiming.rule}`;
      const aggregateTiming = timingsByRule.get(key) ?? {
        rule: ruleTiming.rule,
        timeMilliseconds: 0,
        calls: 0,
        source: ruleTiming.source,
      };
      aggregateTiming.timeMilliseconds += ruleTiming.timeMilliseconds;
      aggregateTiming.calls += ruleTiming.calls;
      timingsByRule.set(key, aggregateTiming);
    }
  }
  const totalTimeMilliseconds = [...timingsByRule.values()].reduce(
    (totalMilliseconds, ruleTiming) => totalMilliseconds + ruleTiming.timeMilliseconds,
    0,
  );
  return [...timingsByRule.values()]
    .map((ruleTiming) => ({
      ...ruleTiming,
      relativePercent:
        totalTimeMilliseconds === 0
          ? 0
          : (ruleTiming.timeMilliseconds / totalTimeMilliseconds) * PERCENT_MULTIPLIER,
    }))
    .toSorted(
      (leftTiming, rightTiming) =>
        rightTiming.timeMilliseconds - leftTiming.timeMilliseconds ||
        leftTiming.rule.localeCompare(rightTiming.rule),
    );
};

const renderAnalysisMarkdown = (analysis: OxlintTimingAnalysis): string => {
  const lines = [
    "# Oxlint rule timing analysis",
    "",
    `Processes: ${analysis.processes.length}`,
    `Summed rule time: ${analysis.totalTimeMilliseconds.toFixed(2)} ms`,
    "",
    "| Rule | Source | Time | Relative | Calls | Average |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const ruleTiming of analysis.aggregateRules.slice(0, PROFILE_TOP_RULE_COUNT)) {
    const averageMilliseconds =
      ruleTiming.calls === 0 ? 0 : ruleTiming.timeMilliseconds / ruleTiming.calls;
    lines.push(
      `| ${ruleTiming.rule.replaceAll("|", "\\|")} | ${ruleTiming.source.replaceAll("|", "\\|")} | ${ruleTiming.timeMilliseconds.toFixed(3)} ms | ${ruleTiming.relativePercent.toFixed(2)}% | ${ruleTiming.calls} | ${averageMilliseconds.toFixed(6)} ms |`,
    );
  }
  lines.push("", "## Processes", "");
  for (const processSummary of analysis.processes) {
    lines.push(
      `- ${processSummary.totalTimeMilliseconds.toFixed(2)} ms — ${path.basename(processSummary.file)}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

export const analyzeOxlintTimings = (profileDirectory: string): OxlintTimingAnalysis => {
  const processes = [
    ...collectProfilePaths({
      directory: profileDirectory,
      extension: ".timings.txt",
    }),
    ...collectProfilePaths({
      directory: profileDirectory,
      extension: ".rule-timings.json",
    }),
  ].map(analyzeTimingFile);
  if (processes.length === 0) {
    throw new Error(`No rule timing files found in ${profileDirectory}`);
  }
  const aggregateRules = aggregateRuleTimings(processes);
  return {
    generatedAt: new Date().toISOString(),
    profileDirectory,
    totalTimeMilliseconds: aggregateRules.reduce(
      (totalMilliseconds, ruleTiming) => totalMilliseconds + ruleTiming.timeMilliseconds,
      0,
    ),
    processes,
    aggregateRules,
  };
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runProfileAnalysisMain({
    name: "react-doctor-performance-rules",
    description: "Aggregate Oxlint rule timings captured by the performance harness",
    defaultOutputName: "rule-analysis",
    analyze: analyzeOxlintTimings,
    renderMarkdown: renderAnalysisMarkdown,
  });
}
