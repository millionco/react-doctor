import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";
import {
  STRUCTURED_CLONE_SMALL_BRANCH_COUNT,
  STRUCTURED_CLONE_LARGE_BRANCH_COUNT,
} from "./utils/constants.js";

const traversalCounter = vi.hoisted(() =>
  vi.fn<typeof import("../../utils/walk-ast.js").walkAst>(),
);
vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  return {
    ...originalModule,
    walkAst: traversalCounter.mockImplementation(originalModule.walkAst),
  };
});

describe("structuredClone self-definition program admission work", () => {
  it.each([
    { name: "closed", prefix: "", warningsPerBranch: 0 },
    { name: "replaced", prefix: "global.structuredClone=replacement;", warningsPerBranch: 1 },
  ])("$name", ({ prefix, warningsPerBranch }) => {
    const measureProgramTraversals = (branchCount: number): number => {
      const branches = Array.from(
        { length: branchCount },
        (_, branchIndex) =>
          `if(value.flag===${branchIndex})return JSON.parse(JSON.stringify(value));`,
      ).join("");
      const code = `${prefix}global.structuredClone=value=>{${branches}};`;
      traversalCounter.mockClear();
      const result = runRule(noJsonParseStringifyClone, code, {
        filename: "src/self-definition-work.tsx",
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(branchCount * warningsPerBranch);
      return traversalCounter.mock.calls.filter(([rootNode]) => rootNode.type === "Program").length;
    };
    const smallTraversalCount = measureProgramTraversals(STRUCTURED_CLONE_SMALL_BRANCH_COUNT);
    const largeTraversalCount = measureProgramTraversals(STRUCTURED_CLONE_LARGE_BRANCH_COUNT);
    expect(smallTraversalCount).toBeGreaterThan(0);
    expect(largeTraversalCount).toBe(smallTraversalCount);
  });
});
