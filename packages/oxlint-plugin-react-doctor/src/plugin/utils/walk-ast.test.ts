import { describe, expect, it } from "vite-plus/test";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const parseProgram = () => {
  const program = parseSourceText({
    filename: "/tmp/walk-ast.ts",
    sourceText: "const value = createValue(1);",
    shouldAttachParentReferences: true,
  });
  if (program === null) throw new Error("Expected test source to parse");
  return program;
};

describe("walkAst", () => {
  it("visits own AST children in source order and ignores inherited nodes", () => {
    const program = parseProgram();
    const inheritedProgram = parseSourceText({
      filename: "/tmp/inherited.ts",
      sourceText: "inherited();",
      shouldAttachParentReferences: true,
    });
    if (inheritedProgram === null) throw new Error("Expected inherited test source to parse");
    Object.setPrototypeOf(program, { inheritedProgram });

    const visitedNodeTypes: string[] = [];
    walkAst(program, (node) => {
      visitedNodeTypes.push(node.type);
    });

    expect(visitedNodeTypes).toEqual([
      "Program",
      "VariableDeclaration",
      "VariableDeclarator",
      "Identifier",
      "CallExpression",
      "Identifier",
      "Literal",
    ]);
  });

  it("preserves subtree pruning semantics", () => {
    const program = parseProgram();
    const visitedNodeTypes: string[] = [];
    walkAst(program, (node) => {
      visitedNodeTypes.push(node.type);
      if (node.type === "CallExpression") return false;
    });

    expect(visitedNodeTypes).toEqual([
      "Program",
      "VariableDeclaration",
      "VariableDeclarator",
      "Identifier",
      "CallExpression",
    ]);
  });

  it("visits runtime decorator expressions", () => {
    const program = parseSourceText({
      filename: "/tmp/walk-ast-decorator.ts",
      sourceText: "@register(() => value)\nclass Example {}",
      shouldAttachParentReferences: true,
    });
    if (program === null) throw new Error("Expected decorator source to parse");

    const visitedNodeTypes: string[] = [];
    walkAst(program, (node) => {
      visitedNodeTypes.push(node.type);
    });

    expect(visitedNodeTypes).toContain("Decorator");
    expect(visitedNodeTypes).toContain("ArrowFunctionExpression");
  });
});
