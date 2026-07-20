import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import { executesDuringRender } from "./executes-during-render.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "./find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isFunctionInvokedDuringRender = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionSymbolIds: Set<number> = new Set(),
): boolean => {
  if (componentOrHookDisplayNameForFunction(functionNode)) return true;
  if (
    executesDuringRender(functionNode, scopes) &&
    findRenderPhaseComponentOrHook(functionNode, scopes)
  ) {
    return true;
  }

  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const functionSymbol = scopes.symbolFor(bindingIdentifier);
  if (!functionSymbol || visitedFunctionSymbolIds.has(functionSymbol.id)) return false;
  visitedFunctionSymbolIds.add(functionSymbol.id);

  return functionSymbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    if (
      executesDuringRender(referenceRoot, scopes) &&
      findRenderPhaseComponentOrHook(referenceRoot, scopes)
    ) {
      return true;
    }
    const callExpression = referenceRoot.parent;
    if (
      !isNodeOfType(callExpression, "CallExpression") ||
      callExpression.callee !== referenceRoot
    ) {
      return false;
    }
    if (findRenderPhaseComponentOrHook(callExpression, scopes)) return true;
    const callerFunction = findEnclosingFunction(callExpression);
    return Boolean(
      callerFunction &&
      isFunctionInvokedDuringRender(callerFunction, scopes, new Set(visitedFunctionSymbolIds)),
    );
  });
};
