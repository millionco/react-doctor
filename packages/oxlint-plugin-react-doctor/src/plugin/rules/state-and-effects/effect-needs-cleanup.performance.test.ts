import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const SMALL_HANDLER_COUNT = 100;
const LARGE_HANDLER_COUNT = 500;
const MEASUREMENT_REPETITION_COUNT = 3;
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

const measureFastestDuration = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
): number => {
  const source = buildRetainedHandlersSource(handlerCount, buildRegistration);
  let fastestDuration = Number.POSITIVE_INFINITY;
  for (let repetition = 0; repetition < MEASUREMENT_REPETITION_COUNT; repetition += 1) {
    const startedAt = performance.now();
    const result = runRule(effectNeedsCleanup, source);
    fastestDuration = Math.min(fastestDuration, performance.now() - startedAt);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(handlerCount);
  }
  return fastestDuration;
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
      measureFastestDuration(SMALL_HANDLER_COUNT, performanceCase.buildRegistration);
      const smallDuration = measureFastestDuration(
        SMALL_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      const largeDuration = measureFastestDuration(
        LARGE_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      expect(largeDuration).toBeLessThan(smallDuration * MAXIMUM_SCALING_MULTIPLIER);
    });
  }
});
