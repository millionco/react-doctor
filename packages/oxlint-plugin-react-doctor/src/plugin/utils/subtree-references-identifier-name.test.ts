import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { subtreeReferencesIdentifierName } from "./subtree-references-identifier-name.js";

const parseExpression = (sourceText: string): EsTreeNode => {
  const program = parseSourceText({ filename: "/tmp/references.ts", sourceText });
  const statement = isNodeOfType(program, "Program") ? program.body[0] : null;
  if (!isNodeOfType(statement, "ExpressionStatement")) {
    throw new Error("Expected an expression statement");
  }
  return statement.expression;
};

describe("subtreeReferencesIdentifierName", () => {
  it("recognizes value references and shorthand properties", () => {
    expect(subtreeReferencesIdentifierName(parseExpression("target.value"), "target")).toBe(true);
    expect(subtreeReferencesIdentifierName(parseExpression("({ target })"), "target")).toBe(true);
  });

  it("ignores static property names", () => {
    expect(subtreeReferencesIdentifierName(parseExpression("source.target"), "target")).toBe(false);
    expect(subtreeReferencesIdentifierName(parseExpression("({ target: source })"), "target")).toBe(
      false,
    );
  });

  it("ignores a matching name shadowed by a nested function parameter", () => {
    expect(
      subtreeReferencesIdentifierName(parseExpression("(target) => target.value"), "target"),
    ).toBe(false);
  });
});
