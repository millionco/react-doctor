import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";

describe("resolveExactLocalFunction", () => {
  it("resolves a simple function reference", () => {
    const program = parseSourceText({
      filename: "/tmp/test.ts",
      sourceText: `
        const helper = () => {};
        helper();
      `,
    });
    if (!program || !isNodeOfType(program, "Program")) throw new Error("Expected source to parse");

    const scopes = analyzeScopes(program);
    const expressionStatement = program.body[1];
    if (!expressionStatement || !isNodeOfType(expressionStatement, "ExpressionStatement")) {
      throw new Error("Expected ExpressionStatement");
    }
    const callExpression = expressionStatement.expression;
    if (!isNodeOfType(callExpression, "CallExpression")) {
      throw new Error("Expected CallExpression");
    }

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });

  it("respects depth limit to prevent infinite recursion", () => {
    let sourceText = "const fn0 = () => {};\n";
    for (let index = 1; index <= 20; index++) {
      sourceText += `const obj${index} = { prop: obj${index - 1 === 0 ? "fn0" : index - 1} };\n`;
    }
    sourceText += "obj20.prop();";

    const program = parseSourceText({
      filename: "/tmp/test.ts",
      sourceText,
    });
    if (!program || !isNodeOfType(program, "Program")) throw new Error("Expected source to parse");

    const scopes = analyzeScopes(program);
    const expressionStatement = program.body[program.body.length - 1];
    if (!expressionStatement || !isNodeOfType(expressionStatement, "ExpressionStatement")) {
      throw new Error("Expected ExpressionStatement");
    }
    const callExpression = expressionStatement.expression;
    if (!isNodeOfType(callExpression, "CallExpression")) {
      throw new Error("Expected CallExpression");
    }

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved).toBe(null);
  });

  it("resolves through member expressions within depth limit", () => {
    const program = parseSourceText({
      filename: "/tmp/test.ts",
      sourceText: `
        const obj = {
          helper: () => {}
        };
        obj.helper();
      `,
    });
    if (!program || !isNodeOfType(program, "Program")) throw new Error("Expected source to parse");

    const scopes = analyzeScopes(program);
    const expressionStatement = program.body[1];
    if (!expressionStatement || !isNodeOfType(expressionStatement, "ExpressionStatement")) {
      throw new Error("Expected ExpressionStatement");
    }
    const callExpression = expressionStatement.expression;
    if (!isNodeOfType(callExpression, "CallExpression")) {
      throw new Error("Expected CallExpression");
    }

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });

  it("handles bind, call, and apply within depth limit", () => {
    const program = parseSourceText({
      filename: "/tmp/test.ts",
      sourceText: `
        const helper = () => {};
        const bound = helper.bind(null);
        bound();
      `,
    });
    if (!program || !isNodeOfType(program, "Program")) throw new Error("Expected source to parse");

    const scopes = analyzeScopes(program);
    const expressionStatement = program.body[2];
    if (!expressionStatement || !isNodeOfType(expressionStatement, "ExpressionStatement")) {
      throw new Error("Expected ExpressionStatement");
    }
    const callExpression = expressionStatement.expression;
    if (!isNodeOfType(callExpression, "CallExpression")) {
      throw new Error("Expected CallExpression");
    }

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });
});
