import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

describe("findVariableInitializer", () => {
  it("selects the closest visible binding without leaking sibling block bindings", () => {
    const program = parseSourceText({
      filename: "/tmp/find-variable-initializer.ts",
      sourceText: `
        const value = 1;
        function read() {
          const value = 2;
          return value;
        }
        {
          const hidden = [];
        }
        consume(hidden);
      `,
    });
    if (program === null) throw new Error("Expected test source to parse");

    let valueReference: EsTreeNode | null = null;
    let hiddenReference: EsTreeNode | null = null;
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "value" &&
        isNodeOfType(node.parent, "ReturnStatement")
      ) {
        valueReference = node;
      }
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "hidden" &&
        isNodeOfType(node.parent, "CallExpression")
      ) {
        hiddenReference = node;
      }
    });

    if (!valueReference || !hiddenReference) {
      throw new Error("Expected test references to exist");
    }
    const valueBinding = findVariableInitializer(valueReference, "value");
    expect(valueBinding?.initializer).toMatchObject({ type: "Literal", value: 2 });
    expect(findVariableInitializer(hiddenReference, "value")?.initializer).toMatchObject({
      type: "Literal",
      value: 1,
    });
    expect(findVariableInitializer(hiddenReference, "hidden")).toBeNull();
    expect(findVariableInitializer(hiddenReference, "value")?.initializer).toMatchObject({
      type: "Literal",
      value: 1,
    });
  });

  it("retains default parameter initializers", () => {
    const program = parseSourceText({
      filename: "/tmp/find-variable-initializer.ts",
      sourceText: `
        function read(value = []) {
          return value;
        }
      `,
    });
    if (program === null) throw new Error("Expected test source to parse");

    let valueReference: EsTreeNode | null = null;
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "value" &&
        isNodeOfType(node.parent, "ReturnStatement")
      ) {
        valueReference = node;
      }
    });
    if (!valueReference) throw new Error("Expected test reference to exist");

    expect(findVariableInitializer(valueReference, "value")?.initializer).toMatchObject({
      type: "ArrayExpression",
    });
  });
});
