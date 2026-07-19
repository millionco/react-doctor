import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "./es-tree-node.js";
import { isEarlyExitStatement } from "./is-early-exit-statement.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

const parseFunctionStatement = (sourceText: string): EsTreeNode => {
  const program = parseSourceText({
    filename: "/tmp/early-exit.ts",
    sourceText: `function example() { ${sourceText} }`,
  });
  const declaration = isNodeOfType(program, "Program") ? program.body[0] : null;
  if (!isNodeOfType(declaration, "FunctionDeclaration")) {
    throw new Error("Expected a function declaration");
  }
  const statement = declaration.body.body[0];
  if (!statement) throw new Error("Expected a function statement");
  return statement;
};

const parseLoopBodyStatement = (exitKeyword: "break" | "continue"): EsTreeNode => {
  const loop = parseFunctionStatement(`while (true) { { ${exitKeyword}; } }`);
  if (!isNodeOfType(loop, "WhileStatement") || !isNodeOfType(loop.body, "BlockStatement")) {
    throw new Error("Expected a while statement");
  }
  const statement = loop.body.body[0];
  if (!statement) throw new Error("Expected a loop body statement");
  return statement;
};

describe("isEarlyExitStatement", () => {
  it("recognizes nested branches that all exit", () => {
    expect(
      isEarlyExitStatement(parseFunctionStatement("if (value) return; else throw error;")),
    ).toBe(true);
  });

  it("recognizes loop-local break and continue exits", () => {
    expect(isEarlyExitStatement(parseLoopBodyStatement("continue"))).toBe(true);
    expect(isEarlyExitStatement(parseLoopBodyStatement("break"))).toBe(true);
  });

  it("rejects a conditional branch that can fall through", () => {
    expect(isEarlyExitStatement(parseFunctionStatement("if (value) return;"))).toBe(false);
  });
});
