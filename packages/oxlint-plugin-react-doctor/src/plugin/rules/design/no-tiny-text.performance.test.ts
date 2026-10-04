import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTinyText } from "./no-tiny-text.js";

const SMALL_NESTING_DEPTH = 100;
const LARGE_NESTING_DEPTH = 400;
const MEASUREMENT_SAMPLE_COUNT = 5;
const MAXIMUM_SCALING_MULTIPLIER = 10;

const buildNestedJsxSource = (nestingDepth: number): string => {
  const openingElements = '<div className="level">'.repeat(nestingDepth);
  const closingElements = "</div>".repeat(nestingDepth);
  return `export const DeepTree = () => (${openingElements}{value}${closingElements});`;
};

const measureFastestDuration = (nestingDepth: number): number => {
  const source = buildNestedJsxSource(nestingDepth);
  const sampleDurations = Array.from({ length: MEASUREMENT_SAMPLE_COUNT }, () => {
    const startedAt = process.hrtime.bigint();
    const result = runRule(noTinyText, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    return Number(process.hrtime.bigint() - startedAt);
  });
  return Math.min(...sampleDurations);
};

describe("no-tiny-text performance", () => {
  it("scales near-linearly across deeply nested JSX", () => {
    measureFastestDuration(SMALL_NESTING_DEPTH);
    measureFastestDuration(LARGE_NESTING_DEPTH);
    const smallDuration = measureFastestDuration(SMALL_NESTING_DEPTH);
    const largeDuration = measureFastestDuration(LARGE_NESTING_DEPTH);
    expect(largeDuration).toBeLessThan(smallDuration * MAXIMUM_SCALING_MULTIPLIER);
  });
});
