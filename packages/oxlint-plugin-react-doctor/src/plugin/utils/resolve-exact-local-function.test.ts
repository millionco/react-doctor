import { describe, expect, it } from "vite-plus/test";
import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";

interface ParsedCallExpression {
  callExpression: EsTreeNodeOfType<"CallExpression">;
  scopes: ScopeAnalysis;
}

const FUNCTION_RESOLUTION_STACK_STRESS_CHAIN_LENGTH = 3_375;

const buildMemberFunctionChainSource = (chainLength: number): string => {
  const statements = ["const object0 = { handler: () => {} };"];
  for (let index = 1; index <= chainLength; index++) {
    statements.push(`const object${index} = { handler: object${index - 1}.handler };`);
  }
  statements.push(`object${chainLength}.handler();`);
  return statements.join("\n");
};

const parseLastCallExpression = (sourceText: string): ParsedCallExpression => {
  const program = parseSourceText({ filename: "/tmp/test.ts", sourceText });
  if (!program || !isNodeOfType(program, "Program")) throw new Error("Expected source to parse");

  const expressionStatement = program.body.at(-1);
  if (!expressionStatement || !isNodeOfType(expressionStatement, "ExpressionStatement")) {
    throw new Error("Expected ExpressionStatement");
  }
  const callExpression = expressionStatement.expression;
  if (!isNodeOfType(callExpression, "CallExpression")) {
    throw new Error("Expected CallExpression");
  }
  return { callExpression, scopes: analyzeScopes(program) };
};

describe("resolveExactLocalFunction", () => {
  it.each([
    `const create = (kind) => () => kind; const Local = { handler: create("state") };`,
    `const create = () => { return () => 1; }; const Local = { handler: create() };`,
  ])("resolves a literal-argument factory's returned function: %s", (setup) => {
    const { callExpression, scopes } = parseLastCallExpression(`${setup}\nLocal.handler();`);
    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });

  it.each([
    `const create = async () => () => 1; const Local = { handler: create() };`,
    `function* create() { return () => 1; } const Local = { handler: create() };`,
    `const create = (callback) => () => callback(); const Local = { handler: create(unknown) };`,
    `const create = () => unknown; const Local = { handler: create() };`,
    `const create = () => { sideEffect(); return () => 1; }; const Local = { handler: create() };`,
    `const create = () => () => 1; const Local = { handler: create() }; mutate(Local);`,
    `const create = () => () => 1; const Local = { handler: create() }; Local.handler = unknown;`,
    `const create = () => create(); const Local = { handler: create() };`,
  ])("keeps an uncertain factory member unresolved: %s", (setup) => {
    const { callExpression, scopes } = parseLastCallExpression(`${setup}\nLocal.handler();`);
    expect(resolveExactLocalFunction(callExpression.callee, scopes)).toBe(null);
  });

  it("resolves a simple function reference", () => {
    const { callExpression, scopes } = parseLastCallExpression(`
        const helper = () => {};
        helper();
      `);

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });

  it("returns null for a pathological member chain without overflowing the stack", () => {
    const { callExpression, scopes } = parseLastCallExpression(
      buildMemberFunctionChainSource(FUNCTION_RESOLUTION_STACK_STRESS_CHAIN_LENGTH),
    );

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved).toBe(null);
  });

  it("resolves a member chain within the depth limit", () => {
    const resolvableChainLength = FUNCTION_RESOLUTION_MAX_DEPTH - 1;
    const { callExpression, scopes } = parseLastCallExpression(
      buildMemberFunctionChainSource(resolvableChainLength),
    );

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });

  it("resolves through member expressions within depth limit", () => {
    const { callExpression, scopes } = parseLastCallExpression(`
        const obj = {
          helper: () => {}
        };
        obj.helper();
      `);

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });

  it("resolves a bound function within the depth limit", () => {
    const { callExpression, scopes } = parseLastCallExpression(`
        const helper = () => {};
        const bound = helper.bind(null);
        bound();
      `);

    const resolved = resolveExactLocalFunction(callExpression.callee, scopes);
    expect(resolved?.type).toBe("ArrowFunctionExpression");
  });
});
