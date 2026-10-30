import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import type { EsTreeNode } from "./es-tree-node.js";
import {
  NUMERIC_DATA_LARGE_READ_COUNT,
  NUMERIC_DATA_MAXIMUM_VISIT_SCALING_MULTIPLIER,
  NUMERIC_DATA_SMALL_READ_COUNT,
} from "../constants/thresholds.js";
import { hookUseState } from "../rules/react-builtins/hook-use-state.js";

interface NumericDataWork {
  programWalkCount: number;
  visitedNodeCount: number;
}

const traversalWork = vi.hoisted(() => ({ programWalkCount: 0, visitedNodeCount: 0 }));

vi.mock("./walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("./walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
      if (node.type === "Program") traversalWork.programWalkCount += 1;
      originalModule.walkAst(node, (child) => {
        traversalWork.visitedNodeCount += 1;
        return visitor(child);
      });
    },
  };
});

const buildSource = (readCount: number, replaceNumber = false): string => {
  const reads = Array.from({ length: readCount }, () => "values[getKey()]").join(" + ");
  return `import {useState} from "react";
    ${replaceNumber ? "Number = customNumber;" : ""}
    export const Panel = input => {
      const [stored] = useState(7);
      const values = [3, 7];
      const getKey = () => Number(input);
      const total = ${reads};
      return <span>{stored + total}</span>;
    };`;
};

const measureWork = (readCount: number): NumericDataWork => {
  traversalWork.programWalkCount = 0;
  traversalWork.visitedNodeCount = 0;
  const result = runRule(hookUseState, buildSource(readCount));
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  return { ...traversalWork };
};

describe("numeric data provider work", () => {
  it("amortizes stable program and binding facts across computed reads", () => {
    const small = measureWork(NUMERIC_DATA_SMALL_READ_COUNT);
    const large = measureWork(NUMERIC_DATA_LARGE_READ_COUNT);
    expect(small.programWalkCount).toBeGreaterThan(0);
    expect(large.programWalkCount).toBe(small.programWalkCount);
    expect(small.visitedNodeCount).toBeGreaterThan(0);
    expect(large.visitedNodeCount).toBeLessThan(
      small.visitedNodeCount * NUMERIC_DATA_MAXIMUM_VISIT_SCALING_MULTIPLIER,
    );
  });

  it("still reports a visible Number replacement on a fresh program", () => {
    const result = runRule(hookUseState, buildSource(NUMERIC_DATA_SMALL_READ_COUNT, true));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const clean = runRule(hookUseState, buildSource(NUMERIC_DATA_SMALL_READ_COUNT));
    expect(clean.parseErrors).toEqual([]);
    expect(clean.diagnostics).toEqual([]);
  });
});
