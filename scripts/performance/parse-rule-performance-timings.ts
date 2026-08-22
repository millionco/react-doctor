import { NANOSECONDS_PER_MILLISECOND } from "./constants.ts";
import type { CapturedRulePerformanceTiming, OxlintRuleTiming } from "./types.ts";

const isCapturedRulePerformanceTiming = (value: unknown): value is CapturedRulePerformanceTiming =>
  typeof value === "object" &&
  value !== null &&
  "rule" in value &&
  typeof value.rule === "string" &&
  "selector" in value &&
  typeof value.selector === "string" &&
  "timeNanoseconds" in value &&
  typeof value.timeNanoseconds === "string" &&
  "calls" in value &&
  typeof value.calls === "number";

export const parseRulePerformanceTimings = (output: string): OxlintRuleTiming[] => {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || !parsed.every(isCapturedRulePerformanceTiming)) {
    throw new Error("Invalid React Doctor rule timing payload");
  }
  return parsed.map((timing) => ({
    rule: `react-doctor/${timing.rule}:${timing.selector}`,
    timeMilliseconds: Number(BigInt(timing.timeNanoseconds)) / NANOSECONDS_PER_MILLISECOND,
    relativePercent: 0,
    calls: timing.calls,
    source: "javascript",
  }));
};
