import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const SMALL_HANDLER_COUNT = 500;
const LARGE_HANDLER_COUNT = 2500;
const MEASUREMENT_SAMPLE_COUNT = 7;
const MAXIMUM_SCALING_MULTIPLIER = 15;

const buildRetainedHandlersSource = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
): string => {
  const handlers = Array.from(
    { length: handlerCount },
    (_, handlerIndex) =>
      `const handler${handlerIndex} = () => { ${buildRegistration(handlerIndex)} };`,
  ).join("\n");
  const buttons = Array.from(
    { length: handlerCount },
    (_, handlerIndex) => `<button onClick={handler${handlerIndex}} />`,
  ).join("\n");
  return `const Component = () => {\n${handlers}\nreturn <>${buttons}</>;\n};`;
};

const measureDuration = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
): number => {
  const source = buildRetainedHandlersSource(handlerCount, buildRegistration);
  const sampleDurations = Array.from({ length: MEASUREMENT_SAMPLE_COUNT }, () => {
    const startedAt = process.hrtime.bigint();
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(handlerCount);
    return Number(process.hrtime.bigint() - startedAt);
  });
  sampleDurations.sort((firstDuration, secondDuration) => firstDuration - secondDuration);
  return sampleDurations[Math.floor(sampleDurations.length / 2)] ?? Number.POSITIVE_INFINITY;
};

describe("effect-needs-cleanup performance", () => {
  for (const performanceCase of [
    {
      name: "timers",
      buildRegistration: (handlerIndex: number) => `setInterval(task${handlerIndex}, 1000);`,
    },
    {
      name: "listeners",
      buildRegistration: (handlerIndex: number) =>
        `window.addEventListener("resize", listener${handlerIndex});`,
    },
  ]) {
    it(`scales near-linearly across retained ${performanceCase.name}`, () => {
      measureDuration(SMALL_HANDLER_COUNT, performanceCase.buildRegistration);
      measureDuration(LARGE_HANDLER_COUNT, performanceCase.buildRegistration);
      const smallDuration = measureDuration(SMALL_HANDLER_COUNT, performanceCase.buildRegistration);
      const largeDuration = measureDuration(LARGE_HANDLER_COUNT, performanceCase.buildRegistration);
      expect(largeDuration).toBeLessThan(smallDuration * MAXIMUM_SCALING_MULTIPLIER);
    });
  }
});
