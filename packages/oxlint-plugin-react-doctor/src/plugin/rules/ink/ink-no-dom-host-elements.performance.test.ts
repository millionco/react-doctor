import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { inkNoDomHostElements } from "./ink-no-dom-host-elements.js";

const SMALL_NESTING_DEPTH = 100;
const LARGE_NESTING_DEPTH = 400;
const MEASUREMENT_SAMPLE_COUNT = 5;
const MAXIMUM_SCALING_MULTIPLIER = 10;

const buildNestedJsxSource = (nestingDepth: number): string => {
  const openingElements = "<div>".repeat(nestingDepth);
  const closingElements = "</div>".repeat(nestingDepth);
  return `export const DeepTree = () => (${openingElements}{value}${closingElements});`;
};

const measureDuration = (nestingDepth: number): number => {
  const source = buildNestedJsxSource(nestingDepth);
  const sampleDurations = Array.from({ length: MEASUREMENT_SAMPLE_COUNT }, () => {
    const startedAt = process.hrtime.bigint();
    const result = runRule(inkNoDomHostElements, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    return Number(process.hrtime.bigint() - startedAt);
  });
  sampleDurations.sort((firstDuration, secondDuration) => firstDuration - secondDuration);
  return sampleDurations[Math.floor(sampleDurations.length / 2)] ?? Number.POSITIVE_INFINITY;
};

describe("ink-no-dom-host-elements performance", () => {
  it("scales near-linearly across deeply nested JSX", () => {
    measureDuration(SMALL_NESTING_DEPTH);
    measureDuration(LARGE_NESTING_DEPTH);
    const smallDuration = measureDuration(SMALL_NESTING_DEPTH);
    const largeDuration = measureDuration(LARGE_NESTING_DEPTH);
    expect(largeDuration).toBeLessThan(smallDuration * MAXIMUM_SCALING_MULTIPLIER);
  });
});
