import { describe, expect, it } from "vite-plus/test";
import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";

const FUNCTION_RESOLUTION_STACK_STRESS_CHAIN_LENGTH = 3_375;

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

  it("returns null for a pathological member chain without overflowing the stack", () => {
    let sourceText = "const object0 = { handler: () => {} };\n";
    for (let index = 1; index <= FUNCTION_RESOLUTION_STACK_STRESS_CHAIN_LENGTH; index++) {
      sourceText += `const object${index} = { handler: object${index - 1}.handler };\n`;
    }
    sourceText += `object${FUNCTION_RESOLUTION_STACK_STRESS_CHAIN_LENGTH}.handler();`;

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

  it("resolves a member chain within the depth limit", () => {
    const resolvableChainLength = FUNCTION_RESOLUTION_MAX_DEPTH - 1;
    let sourceText = "const object0 = { handler: () => {} };\n";
    for (let index = 1; index <= resolvableChainLength; index++) {
      sourceText += `const object${index} = { handler: object${index - 1}.handler };\n`;
    }
    sourceText += `object${resolvableChainLength}.handler();`;

    const program = parseSourceText({ filename: "/tmp/test.ts", sourceText });
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
    expect(resolved?.type).toBe("ArrowFunctionExpression");
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
