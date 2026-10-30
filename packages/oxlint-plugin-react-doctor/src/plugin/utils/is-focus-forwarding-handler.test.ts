import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import * as providerProof from "./is-proven-unmodified-react-api-call.js";
import * as providerMutation from "./has-react-default-provider-mutation.js";
import * as astWalk from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isFocusForwardingOrBlockingHandlerExpression } from "./is-focus-forwarding-handler.js";

interface PreparedNativeFocusProgram {
  program: EsTreeNode;
  scopes: ScopeAnalysis;
  expressions: EsTreeNode[];
}

const prepareNativeFocusProgram = (prefix = ""): PreparedNativeFocusProgram => {
  const declarations = Array.from(
    { length: 16 },
    (_, index) =>
      `const focus${index} = ${index % 2 ? "firstCache" : "secondCache"}(() => document.getElementById("reed-search")?.focus(), []);`,
  ).join("\n");
  const children = Array.from(
    { length: 16 },
    (_, index) => `<div onClick={focus${index}} /><div onClick={focus${index}} />`,
  ).join("\n");
  const parsed =
    parseFixture(`import { useCallback as firstCache, useCallback as secondCache } from "react";
    ${prefix}
    export const ReedFields = () => { ${declarations} return <>${children}</>; };`);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const expressions: EsTreeNode[] = [];
  astWalk.walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "JSXAttribute") && isNodeOfType(node.value, "JSXExpressionContainer"))
      expressions.push(node.value.expression);
  });
  return { program: parsed.program, scopes: analyzeScopes(parsed.program), expressions };
};

afterEach(() => vi.restoreAllMocks());

describe("native focus proof work and isolation", () => {
  it("resolves a long alias chain without copying descriptor prefixes", () => {
    const aliasCount = 96;
    const aliases = Array.from(
      { length: aliasCount - 1 },
      (_, index) => `const focus${index + 1} = focus${index};`,
    ).join("\n");
    const parsed = parseFixture(`import { useCallback } from "react";
      export const ReedField = () => {
        const focus0 = useCallback(() => document.getElementById("reed-search")?.focus(), []);
        ${aliases}
        return <div onClick={focus${aliasCount - 1}} />;
      };`);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    let handlerExpression: EsTreeNode | undefined;
    astWalk.walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "JSXAttribute") && isNodeOfType(node.value, "JSXExpressionContainer"))
        handlerExpression = node.value.expression;
    });
    if (!handlerExpression) throw new Error("Expected the synthetic click handler");
    const originalScopes = analyzeScopes(parsed.program);
    let symbolLookupCount = 0;
    const scopes: ScopeAnalysis = {
      ...originalScopes,
      symbolFor: (node) => {
        symbolLookupCount += 1;
        return originalScopes.symbolFor(node);
      },
    };
    expect(isFocusForwardingOrBlockingHandlerExpression(handlerExpression, scopes)).toBe(true);
    symbolLookupCount = 0;
    let copiedBindingCount = 0;
    const originalIterator = Array.prototype[Symbol.iterator];
    const iteratorProbe = new Proxy(originalIterator, {
      apply: (target, receiver) => {
        const iterator = target.call(receiver);
        if (
          !Array.isArray(receiver) ||
          !receiver.length ||
          typeof receiver[0] !== "object" ||
          !receiver[0] ||
          !("bindingIdentifier" in receiver[0])
        )
          return iterator;
        return new Proxy(iterator, {
          get: (iteratorTarget, property) => {
            if (property !== "next") return Reflect.get(iteratorTarget, property, iteratorTarget);
            return () => {
              const result = iteratorTarget.next();
              if (!result.done) copiedBindingCount += 1;
              return result;
            };
          },
        });
      },
    });
    let isFocusForwarding = false;
    // HACK: Spy call recording also iterates arrays, so instrument this synchronous call directly.
    Array.prototype[Symbol.iterator] = iteratorProbe;
    try {
      isFocusForwarding = isFocusForwardingOrBlockingHandlerExpression(handlerExpression, scopes);
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    expect(isFocusForwarding).toBe(true);
    expect(copiedBindingCount).toBe(0);
    expect(symbolLookupCount).toBe(aliasCount + 1);
  });

  it("delegates each imported provider once and scans a shared program a bounded number of times", () => {
    const prepared = prepareNativeFocusProgram();
    const importedProof = vi.spyOn(providerProof, "isProvenUnmodifiedReactApiCall");
    const mutationProof = vi.spyOn(providerMutation, "hasReactDefaultProviderMutation");
    const programWalk = vi.spyOn(astWalk, "walkAst");
    for (const expression of prepared.expressions) {
      expect(isFocusForwardingOrBlockingHandlerExpression(expression, prepared.scopes)).toBe(true);
      expect(isFocusForwardingOrBlockingHandlerExpression(expression, prepared.scopes)).toBe(true);
    }
    expect(importedProof).toHaveBeenCalledTimes(2);
    expect(mutationProof).toHaveBeenCalledTimes(1);
    expect(programWalk.mock.calls.filter(([program]) => program === prepared.program)).toHaveLength(
      2,
    );
  });

  it("keeps proofs separate for two analyses of the same program", () => {
    const prepared = prepareNativeFocusProgram();
    const secondScopes = analyzeScopes(prepared.program);
    const importedProof = vi.spyOn(providerProof, "isProvenUnmodifiedReactApiCall");
    const mutationProof = vi.spyOn(providerMutation, "hasReactDefaultProviderMutation");
    for (const scopes of [prepared.scopes, secondScopes]) {
      for (const expression of prepared.expressions)
        expect(isFocusForwardingOrBlockingHandlerExpression(expression, scopes)).toBe(true);
    }
    expect(importedProof).toHaveBeenCalledTimes(4);
    expect(mutationProof).toHaveBeenCalledTimes(2);
  });

  it("keeps exact program facts separate when a host reuses its scope wrapper", () => {
    const native = prepareNativeFocusProgram();
    const replaced = prepareNativeFocusProgram("document.getElementById = customLookup;");
    let activeScopes = native.scopes;
    const scopes: ScopeAnalysis = {
      get rootScope() {
        return activeScopes.rootScope;
      },
      scopeFor: (node) => activeScopes.scopeFor(node),
      ownScopeFor: (node) => activeScopes.ownScopeFor(node),
      symbolFor: (node) => activeScopes.symbolFor(node),
      referenceFor: (node) => activeScopes.referenceFor(node),
      isGlobalReference: (node) => activeScopes.isGlobalReference(node),
    };
    const importedProof = vi.spyOn(providerProof, "isProvenUnmodifiedReactApiCall");
    const mutationProof = vi.spyOn(providerMutation, "hasReactDefaultProviderMutation");
    for (const expression of native.expressions)
      expect(isFocusForwardingOrBlockingHandlerExpression(expression, scopes)).toBe(true);
    activeScopes = replaced.scopes;
    for (const expression of replaced.expressions)
      expect(isFocusForwardingOrBlockingHandlerExpression(expression, scopes)).toBe(false);
    activeScopes = native.scopes;
    for (const expression of native.expressions)
      expect(isFocusForwardingOrBlockingHandlerExpression(expression, scopes)).toBe(true);
    expect(importedProof).toHaveBeenCalledTimes(4);
    expect(mutationProof).toHaveBeenCalledTimes(2);
  });
});
