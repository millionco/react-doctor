import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const DEEPLY_NESTED_AST_NODE_COUNT = 20_000;

const parseProgram = () => {
  const program = parseSourceText({
    filename: "/tmp/walk-ast.ts",
    sourceText: "const value = createValue(1);",
  });
  if (program === null) throw new Error("Expected test source to parse");
  return program;
};

describe("walkAst", () => {
  it("visits AST children in source order", () => {
    const program = parseProgram();
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

  it("walks only own non-parent keys of unknown node types", () => {
    const inheritedChild = { type: "Identifier", name: "inherited" };
    const unknownNode: Record<string, unknown> = Object.assign(Object.create({ inheritedChild }), {
      type: "FutureNode",
      ownChild: { type: "Identifier", name: "own" },
    });
    unknownNode.parent = { type: "Program", body: [unknownNode] };

    const visitedNodeNames: string[] = [];
    walkAst(unknownNode as unknown as EsTreeNode, (node) => {
      visitedNodeNames.push(
        "name" in node && typeof node.name === "string" ? node.name : node.type,
      );
    });

    expect(visitedNodeNames).toEqual(["FutureNode", "own"]);
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

  it("walks ASTs deeper than the JavaScript call stack", () => {
    let rootNode: Record<string, unknown> = { type: "Identifier", name: "leaf" };
    for (let nodeIndex = 1; nodeIndex < DEEPLY_NESTED_AST_NODE_COUNT; nodeIndex += 1) {
      rootNode = { type: "FutureNode", child: rootNode };
    }

    let visitedNodeCount = 0;
    walkAst(rootNode as unknown as EsTreeNode, () => {
      visitedNodeCount += 1;
    });

    expect(visitedNodeCount).toBe(DEEPLY_NESTED_AST_NODE_COUNT);
  });

  it("visits runtime decorator expressions", () => {
    const program = parseSourceText({
      filename: "/tmp/walk-ast-decorator.ts",
      sourceText: "@register(() => value)\nclass Example {}",
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
