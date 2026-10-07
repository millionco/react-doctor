import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTinyText } from "./no-tiny-text.js";

const SMALL_NESTING_DEPTH = 100;
const LARGE_NESTING_DEPTH = 400;
const MAXIMUM_SCALING_MULTIPLIER = 10;

const buildNestedJsxSource = (nestingDepth: number): string => {
  const openingElements = '<div className="level">'.repeat(nestingDepth);
  const closingElements = "</div>".repeat(nestingDepth);
  return `export const DeepTree = () => (${openingElements}{value}${closingElements});`;
};

const countAttributeReads = (nestingDepth: number): number => {
  let attributeReads = 0;
  const result = runRule(
    {
      ...noTinyText,
      create: (context) => {
        const visitors = noTinyText.create(context);
        return {
          ...visitors,
          JSXElement: (node) => {
            const attributes = node.openingElement.attributes;
            Object.defineProperty(node.openingElement, "attributes", {
              get: () => {
                attributeReads += 1;
                return attributes;
              },
            });
            visitors.JSXElement(node);
          },
        };
      },
    },
    buildNestedJsxSource(nestingDepth),
    { forceJsx: true },
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  return attributeReads;
};

describe("no-tiny-text performance", () => {
  it("scales attribute reads near-linearly across deeply nested JSX", () => {
    const smallReadCount = countAttributeReads(SMALL_NESTING_DEPTH);
    const largeReadCount = countAttributeReads(LARGE_NESTING_DEPTH);
    expect(smallReadCount).toBeGreaterThan(0);
    expect(largeReadCount).toBeLessThan(smallReadCount * MAXIMUM_SCALING_MULTIPLIER);
  });
});
