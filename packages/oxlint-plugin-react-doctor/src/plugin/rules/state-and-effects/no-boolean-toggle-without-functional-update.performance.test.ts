import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

const SMALL_SETTER_COUNT = 2_000;
const LARGE_SETTER_COUNT = 10_000;
const MEASUREMENT_SAMPLE_COUNT = 5;
const MAXIMUM_SCALING_MULTIPLIER = 18;

const buildAwaitedTogglesSource = (setterCount: number): string =>
  `const C=()=>{const[open,setOpen]=useState(false);const run=async()=>{await load();${"setOpen(!open);".repeat(setterCount)}}}`;

const measureDuration = (source: string, setterCount: number): number => {
  const startedAt = process.hrtime.bigint();
  const result = runRule(noBooleanToggleWithoutFunctionalUpdate, source);
  const duration = Number(process.hrtime.bigint() - startedAt);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(setterCount);
  return duration;
};

const medianDuration = (durations: readonly number[]): number => {
  const sortedDurations = [...durations].sort(
    (firstDuration, secondDuration) => firstDuration - secondDuration,
  );
  return sortedDurations[Math.floor(sortedDurations.length / 2)] ?? Number.POSITIVE_INFINITY;
};

describe("no-boolean-toggle-without-functional-update performance", () => {
  it("caches await reachability across many setters", () => {
    const smallSource = buildAwaitedTogglesSource(SMALL_SETTER_COUNT);
    const largeSource = buildAwaitedTogglesSource(LARGE_SETTER_COUNT);
    measureDuration(smallSource, SMALL_SETTER_COUNT);
    measureDuration(largeSource, LARGE_SETTER_COUNT);
    const smallDurations: number[] = [];
    const largeDurations: number[] = [];
    // Interleaving keeps both sizes under the same runner load, and the median
    // (unlike the minimum) cannot be won by a single quiet window that only a
    // short run is brief enough to fit inside.
    for (let sampleIndex = 0; sampleIndex < MEASUREMENT_SAMPLE_COUNT; sampleIndex += 1) {
      smallDurations.push(measureDuration(smallSource, SMALL_SETTER_COUNT));
      largeDurations.push(measureDuration(largeSource, LARGE_SETTER_COUNT));
    }
    expect(medianDuration(largeDurations)).toBeLessThan(
      medianDuration(smallDurations) * MAXIMUM_SCALING_MULTIPLIER,
    );
  });
});
