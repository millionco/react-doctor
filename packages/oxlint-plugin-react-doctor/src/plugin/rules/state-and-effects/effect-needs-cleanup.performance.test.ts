import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const SMALL_HANDLER_COUNT = 500;
const LARGE_HANDLER_COUNT = 2500;
const MAXIMUM_SCALING_MULTIPLIER = 15;

const traversalCounter = vi.hoisted(() => vi.fn());

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: ((node, visitor) =>
      originalModule.walkAst(node, (candidate) => {
        traversalCounter();
        return visitor(candidate);
      })) satisfies typeof originalModule.walkAst,
  };
});

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

const measureTraversalWork = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
): number => {
  const source = buildRetainedHandlersSource(handlerCount, buildRegistration);
  traversalCounter.mockClear();
  const result = runRule(effectNeedsCleanup, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(handlerCount);
  return traversalCounter.mock.calls.length;
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
      const smallTraversalCount = measureTraversalWork(
        SMALL_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      const largeTraversalCount = measureTraversalWork(
        LARGE_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      expect(smallTraversalCount).toBeGreaterThan(SMALL_HANDLER_COUNT);
      expect(largeTraversalCount).toBeGreaterThan(smallTraversalCount);
      expect(largeTraversalCount).toBeLessThan(smallTraversalCount * MAXIMUM_SCALING_MULTIPLIER);
    });
  }
});
