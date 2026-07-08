import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionContainsReactRenderOutput } from "./function-contains-react-render-output.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { walkAst } from "./walk-ast.js";

interface FunctionFixture {
  functionNode: EsTreeNode;
  scopes: ScopeAnalysis;
  program: EsTreeNode;
}

const parseFunctionFixture = (code: string, functionName: string): FunctionFixture => {
  const { program, errors } = parseFixture(code);
  expect(errors).toEqual([]);
  attachParentReferences(program);
  let functionNode: EsTreeNode | null = null;
  walkAst(program, (child) => {
    if (functionNode) return false;
    if (!isNodeOfType(child, "FunctionDeclaration")) return;
    if (child.id?.name === functionName) functionNode = child;
  });
  if (!functionNode) throw new Error(`fixture has no function named ${functionName}`);
  return { functionNode, scopes: analyzeScopes(program), program };
};

describe("functionContainsReactRenderOutput", () => {
  it("detects JSX render output, stable across repeated calls", () => {
    const { functionNode, scopes } = parseFunctionFixture(
      `function Card() { return <div>hi</div>; }`,
      "Card",
    );
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(true);
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(true);
  });

  it("returns false for an uppercase factory without render output, stable across repeated calls", () => {
    const { functionNode, scopes } = parseFunctionFixture(
      `function CreateValidator(options: { strict?: boolean }) { return { isStrict: Boolean(options.strict) }; }`,
      "CreateValidator",
    );
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(false);
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(false);
  });

  it("memoizes per (functionNode, scopes): a repeat query with the same inputs skips the re-walk", () => {
    const { functionNode, scopes, program } = parseFunctionFixture(
      `function Card() { return <div>hi</div>; }`,
      "Card",
    );
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(true);
    if (!isNodeOfType(functionNode, "FunctionDeclaration")) {
      throw new Error("fixture function is not a FunctionDeclaration");
    }
    // Emptying the body makes the cache hit observable: a re-walk would now
    // find no JSX and return false, so `true` proves the memoized answer.
    functionNode.body.body = [];
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(true);
    expect(functionContainsReactRenderOutput(functionNode, analyzeScopes(program))).toBe(false);
  });

  it("does not contaminate results across different scope analyses on the same node", () => {
    const { functionNode, scopes } = parseFunctionFixture(
      `import React from "react";
       function Banner() { return React.createElement("div"); }`,
      "Banner",
    );
    const scopesWithoutSymbols: ScopeAnalysis = {
      rootScope: scopes.rootScope,
      scopeFor: scopes.scopeFor,
      ownScopeFor: scopes.ownScopeFor,
      symbolFor: () => null,
      referenceFor: () => null,
      isGlobalReference: () => false,
    };
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(true);
    expect(functionContainsReactRenderOutput(functionNode, scopesWithoutSymbols)).toBe(false);
    expect(functionContainsReactRenderOutput(functionNode, scopes)).toBe(true);
  });
});
