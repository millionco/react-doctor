import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";
import { walkAst } from "../utils/walk-ast.js";
import { analyzeControlFlow } from "./control-flow-graph.js";
import { calculateFunctionComplexity } from "./function-complexity.js";

const measureNamedFunction = (code: string, functionName: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  let matchingFunction: EsTreeNode | null = null;
  walkAst(parsed.program, (node) => {
    if (
      isNodeOfType(node, "FunctionDeclaration") &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === functionName
    ) {
      matchingFunction = node;
      return false;
    }
  });
  if (!matchingFunction) throw new Error(`Could not find function ${functionName}`);
  const functionControlFlow = analyzeControlFlow(parsed.program).cfgFor(matchingFunction);
  if (!functionControlFlow) throw new Error(`Could not build control flow for ${functionName}`);
  return calculateFunctionComplexity(matchingFunction, functionControlFlow);
};

describe("function-complexity", () => {
  it("computes cyclomatic complexity from reachable CFG edges and blocks", () => {
    expect(
      measureNamedFunction(
        `function choose(value) {
          if (value > 0) return "positive";
          if (value < 0) return "negative";
          return "zero";
        }`,
        "choose",
      ).cyclomatic,
    ).toBe(3);
  });

  it("matches the nesting-sensitive cognitive complexity example", () => {
    expect(
      measureNamedFunction(
        `function sumOfPrimes(maximum) {
          let total = 0;
          OUTER: for (let outerIndex = 1; outerIndex <= maximum; outerIndex += 1) {
            for (let innerIndex = 2; innerIndex < outerIndex; innerIndex += 1) {
              if (outerIndex % innerIndex === 0) continue OUTER;
            }
            total += outerIndex;
          }
          return total;
        }`,
        "sumOfPrimes",
      ),
    ).toMatchObject({ cognitive: 7, maxNestingDepth: 3 });
  });

  it("counts a switch once and does not charge each case", () => {
    expect(
      measureNamedFunction(
        `function getWords(value) {
          switch (value) {
            case 1: return "one";
            case 2: return "two";
            default: return "many";
          }
        }`,
        "getWords",
      ).cognitive,
    ).toBe(1);
  });

  it("keeps nested function complexity out of the owning function", () => {
    expect(
      measureNamedFunction(
        `function Parent() {
          const nested = () => {
            if (first) {
              if (second) return source?.value ? true : fallback ?? false;
            }
            return false;
          };
          return nested();
        }`,
        "Parent",
      ),
    ).toMatchObject({ cognitive: 0, cyclomatic: 1, maxNestingDepth: 0 });
  });

  it("counts runs of mixed logical operators", () => {
    expect(
      measureNamedFunction(
        `function logic(first, second, third, fourth) {
          return first && second && third || fourth;
        }`,
        "logic",
      ).cognitive,
    ).toBe(2);
  });

  it("counts source-order transitions back to an earlier logical operator", () => {
    expect(
      measureNamedFunction(
        `function logic(first, second, third, fourth) {
          return first || second && third || fourth;
        }`,
        "logic",
      ).cognitive,
    ).toBe(3);
  });

  it("counts logical runs nested behind non-logical expressions", () => {
    expect(
      measureNamedFunction(
        `function logic(first, second, third) {
          return first && select(second || third);
        }`,
        "logic",
      ).cognitive,
    ).toBe(2);
  });

  it("counts logical runs inside conditional branches independently", () => {
    expect(
      measureNamedFunction(
        `function logic(first, second, third, fourth) {
          return first && (second ? third || fourth : fourth);
        }`,
        "logic",
      ).cognitive,
    ).toBe(3);
  });

  it("adds expression decisions that the statement CFG does not represent", () => {
    expect(
      measureNamedFunction(
        `function choose(first, second, third, fourth, fifth) {
          if (first && second) {
            return third ? fourth : fifth ?? null;
          }
          return null;
        }`,
        "choose",
      ),
    ).toMatchObject({ cognitive: 5, cyclomatic: 5 });
  });

  it("counts every logical assignment as a cyclomatic decision only", () => {
    expect(
      measureNamedFunction(
        `function assign(first, second, third) {
          first &&= true;
          second ||= false;
          third ??= null;
        }`,
        "assign",
      ),
    ).toMatchObject({ cognitive: 0, cyclomatic: 4 });
  });

  it("does not count optional chaining as control-flow complexity", () => {
    expect(
      measureNamedFunction(
        `function read(value) {
          return value?.one?.[0]?.();
        }`,
        "read",
      ),
    ).toMatchObject({ cognitive: 0, cyclomatic: 1 });
  });

  it("adds a flat cognitive point for else without changing cyclomatic paths", () => {
    expect(
      measureNamedFunction(
        `function choose(value) {
          if (value > 0) return "positive";
          else if (value < 0) return "negative";
          else return "zero";
        }`,
        "choose",
      ),
    ).toMatchObject({ cognitive: 3, cyclomatic: 3 });
  });

  it("treats nullish coalescing as a cognitive logical run", () => {
    expect(
      measureNamedFunction(
        `function fallback(first, second, third, fourth) {
          return first ?? second ?? third || fourth;
        }`,
        "fallback",
      ),
    ).toMatchObject({ cognitive: 2, cyclomatic: 4 });
  });
});
