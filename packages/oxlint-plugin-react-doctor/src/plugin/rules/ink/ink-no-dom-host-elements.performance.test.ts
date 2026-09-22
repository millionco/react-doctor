import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { inkNoDomHostElements } from "./ink-no-dom-host-elements.js";

const SMALL_NESTING_DEPTH = 100;
const LARGE_NESTING_DEPTH = 400;
const MAXIMUM_SCALING_MULTIPLIER = 10;

const measureNodeTypeReads = (nestingDepth: number): number => {
  const openingElements = "<div>".repeat(nestingDepth);
  const closingElements = "</div>".repeat(nestingDepth);
  const source = `export const DeepTree = () => (${openingElements}{value}${closingElements});`;
  let nodeTypeReadCount = 0;
  const result = runRule(
    {
      ...inkNoDomHostElements,
      create: (context) => {
        if (!context.sourceCode?.ast) throw new Error("Expected a parsed fixture");
        walkAst(context.sourceCode.ast, (node) => {
          const nodeType = node.type;
          Object.defineProperty(node, "type", {
            configurable: true,
            enumerable: true,
            get: () => {
              nodeTypeReadCount += 1;
              return nodeType;
            },
          });
        });
        nodeTypeReadCount = 0;
        return inkNoDomHostElements.create(context);
      },
    },
    source,
    { forceJsx: true },
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  expect(nodeTypeReadCount).toBeGreaterThan(0);
  return nodeTypeReadCount;
};

describe("ink-no-dom-host-elements performance", () => {
  it("scales near-linearly across deeply nested JSX", () => {
    const smallNodeTypeReadCount = measureNodeTypeReads(SMALL_NESTING_DEPTH);
    const largeNodeTypeReadCount = measureNodeTypeReads(LARGE_NESTING_DEPTH);
    expect(largeNodeTypeReadCount).toBeLessThan(
      smallNodeTypeReadCount * MAXIMUM_SCALING_MULTIPLIER,
    );
  });
});
