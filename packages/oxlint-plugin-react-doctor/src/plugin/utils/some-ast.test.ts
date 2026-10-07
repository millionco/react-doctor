import { describe, expect, it } from "vite-plus/test";
import { parseSourceText } from "./parse-source-file.js";
import { someAst } from "./some-ast.js";

describe("someAst", () => {
  it("stops traversal at the first match", () => {
    const program = parseSourceText({
      filename: "/tmp/some-ast.ts",
      sourceText: "const value = createValue(1);",
    });
    if (program === null) throw new Error("Expected test source to parse");

    const visitedNodeTypes: string[] = [];
    const didFindCall = someAst(program, (node) => {
      visitedNodeTypes.push(node.type);
      return node.type === "CallExpression";
    });

    expect(didFindCall).toBe(true);
    expect(visitedNodeTypes).toEqual([
      "Program",
      "VariableDeclaration",
      "VariableDeclarator",
      "Identifier",
      "CallExpression",
    ]);
  });
});
