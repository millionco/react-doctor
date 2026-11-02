import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findContainingSortedLiteral } from "./find-containing-sorted-literal.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

describe("findContainingSortedLiteral", () => {
  const source = 'const first = "one"; const second = "two";';
  const program = parseSourceText({ filename: "values.ts", sourceText: source });
  const literals: EsTreeNodeOfType<"Literal">[] = [];
  if (!program) throw new Error("Expected valid source");
  walkAst(program, (node) => {
    if (node.type === "Literal" && typeof node.value === "string") literals.push(node);
  });
  literals.sort((left, right) => getNodeStartIndex(left) - getNodeStartIndex(right));

  it.each(["one", "two"])("finds the exact literal for %s", (value) => {
    const startIndex = source.indexOf(value);
    expect(
      findContainingSortedLiteral(literals, startIndex, startIndex + value.length)?.value,
    ).toBe(value);
  });

  it("accepts the full literal range", () => {
    for (const literal of literals) {
      expect(
        findContainingSortedLiteral(literals, getNodeStartIndex(literal), getNodeEndIndex(literal)),
      ).toBe(literal);
    }
  });

  it("rejects uncovered, reversed, and cross-literal ranges", () => {
    const startIndex = source.indexOf("one");
    const endIndex = source.indexOf("two") + "two".length;
    expect(findContainingSortedLiteral([], startIndex, endIndex)).toBeNull();
    expect(findContainingSortedLiteral(literals, source.indexOf("first"), startIndex)).toBeNull();
    expect(findContainingSortedLiteral(literals, source.indexOf("second"), endIndex)).toBeNull();
    expect(findContainingSortedLiteral(literals, startIndex, endIndex)).toBeNull();
    expect(findContainingSortedLiteral(literals, endIndex, startIndex)).toBeNull();
    expect(findContainingSortedLiteral(literals, source.length, source.length)).toBeNull();
  });
});
