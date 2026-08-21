import { PERCENT_MULTIPLIER } from "./constants.ts";
import type { OxlintRuleTiming } from "./types.ts";

const RULE_TIMING_LINE_PATTERN = /^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+)\s+(\S+)$/;

export const parseOxlintTimingOutput = (output: string): OxlintRuleTiming[] => {
  const timingHeaderIndex = output.indexOf("Rule timings:");
  if (timingHeaderIndex === -1) throw new Error("Oxlint output contains no rule timings");
  const rules: OxlintRuleTiming[] = [];
  for (const line of output.slice(timingHeaderIndex).split("\n")) {
    const match = RULE_TIMING_LINE_PATTERN.exec(line.trim());
    if (match === null) continue;
    const [, rule, timeMilliseconds, relativePercent, calls, source] = match;
    if (
      rule === undefined ||
      timeMilliseconds === undefined ||
      relativePercent === undefined ||
      calls === undefined ||
      source === undefined
    ) {
      continue;
    }
    rules.push({
      rule,
      timeMilliseconds: Number(timeMilliseconds),
      relativePercent: Number(relativePercent),
      calls: Number(calls),
      source,
    });
  }
  if (rules.length === 0) throw new Error("Oxlint timing table contains no rules");
  const totalTimeMilliseconds = rules.reduce(
    (totalMilliseconds, rule) => totalMilliseconds + rule.timeMilliseconds,
    0,
  );
  return rules.map((rule) => ({
    ...rule,
    relativePercent:
      totalTimeMilliseconds === 0
        ? 0
        : (rule.timeMilliseconds / totalTimeMilliseconds) * PERCENT_MULTIPLIER,
  }));
};
