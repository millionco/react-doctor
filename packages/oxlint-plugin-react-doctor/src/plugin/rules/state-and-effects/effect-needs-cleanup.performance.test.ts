import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import {
  RETAINED_CLEANUP_LARGE_HANDLER_COUNT,
  RETAINED_CLEANUP_MAXIMUM_VISIT_SCALING_MULTIPLIER,
  RETAINED_CLEANUP_SMALL_HANDLER_COUNT,
} from "../../constants/thresholds.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface RetainedCleanupWork {
  componentBodyWalkCount: number;
  visitedNodeCount: number;
}

const traversalWork = vi.hoisted(() => ({
  componentBodyWalkCount: 0,
  visitedNodeCount: 0,
}));

vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
      if (
        node.type === "BlockStatement" &&
        node.parent?.type === "ArrowFunctionExpression" &&
        node.parent.parent?.type === "VariableDeclarator" &&
        node.parent.parent.parent?.type === "VariableDeclaration" &&
        node.parent.parent.parent.parent?.type === "Program"
      ) {
        traversalWork.componentBodyWalkCount += 1;
      }
      originalModule.walkAst(node, (child) => {
        traversalWork.visitedNodeCount += 1;
        return visitor(child);
      });
    },
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

const measureWork = (
  handlerCount: number,
  buildRegistration: (handlerIndex: number) => string,
): RetainedCleanupWork => {
  traversalWork.componentBodyWalkCount = 0;
  traversalWork.visitedNodeCount = 0;
  const result = runRule(
    effectNeedsCleanup,
    buildRetainedHandlersSource(handlerCount, buildRegistration),
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(handlerCount);
  return { ...traversalWork };
};

describe("effect-needs-cleanup retained handler work", () => {
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
    it(`amortizes component scans across retained ${performanceCase.name}`, () => {
      const smallWork = measureWork(
        RETAINED_CLEANUP_SMALL_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      const largeWork = measureWork(
        RETAINED_CLEANUP_LARGE_HANDLER_COUNT,
        performanceCase.buildRegistration,
      );
      expect(smallWork.componentBodyWalkCount).toBeGreaterThan(0);
      expect(largeWork.componentBodyWalkCount).toBe(smallWork.componentBodyWalkCount);
      expect(smallWork.visitedNodeCount).toBeGreaterThan(0);
      expect(largeWork.visitedNodeCount).toBeLessThan(
        smallWork.visitedNodeCount * RETAINED_CLEANUP_MAXIMUM_VISIT_SCALING_MULTIPLIER,
      );
    });
  }
});
